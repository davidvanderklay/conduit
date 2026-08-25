package media.conduit.client

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import media.conduit.client.account.CatalogItem
import media.conduit.client.account.PlaybackSource
import media.conduit.client.account.ProgressSummary
import media.conduit.client.account.VideoItem

class WatchStatusTest {
    @Test
    fun moviesUseBinaryCompletion() {
        val movie = CatalogItem("movie", "movie", "Movie")
        assertEquals(PosterWatchState.Unwatched, posterWatchState(emptyList(), movie))
        assertEquals(PosterWatchState.Complete, posterWatchState(listOf(progress("movie", "movie", watched = true, type = "movie")), movie))
    }

    @Test
    fun seriesDistinguishPartialAndComplete() {
        val series = CatalogItem("show", "series", "Show")
        assertEquals(PosterWatchState.Partial, posterWatchState(listOf(progress("s1e1", "show", position = 30_000)), series, listOf("s1e1", "s1e2")))
        assertEquals(PosterWatchState.Complete, posterWatchState(listOf(progress("s1e1", "show", watched = true), progress("s1e2", "show", watched = true)), series, listOf("s1e1", "s1e2")))
    }

    @Test
    fun completionExcludesSpecialsAndFutureEpisodes() {
        assertEquals(
            listOf("regular"),
            completionEpisodeIds(
                listOf(
                    VideoItem("regular", season = 1, episode = 1, released = "2026-01-01"),
                    VideoItem("special", season = 0, episode = 1),
                    VideoItem("unavailable", season = 1, episode = 2, available = false),
                    VideoItem("future", season = 1, episode = 2, released = "2027-01-01"),
                ),
                today = "2026-06-01",
            ),
        )
    }

    @Test
    fun episodeStateAndProgressUseExplicitWatchedFlag() {
        assertEquals(EpisodeWatchState.NotStarted, episodeWatchState(null))
        val partial = progress("partial", "show", position = 25_000).copy(durationMs = 100_000)
        assertEquals(EpisodeWatchState.InProgress, episodeWatchState(partial))
        assertEquals(.25f, episodeProgressFraction(partial))
        assertEquals(EpisodeWatchState.Watched, episodeWatchState(partial.copy(watched = true)))
        assertEquals(0f, episodeProgressFraction(partial.copy(watched = true)))
    }

    @Test
    fun resumePositionUsesNuvioTimeFormat() {
        assertEquals("0:06", resumePositionLabel(6_900))
        assertEquals("1:05", resumePositionLabel(65_000))
        assertEquals("1:05:08", resumePositionLabel(3_908_000))
        assertEquals(null, resumePositionLabel(0))
    }

    @Test
    fun seasonActionsIncludeEveryReleasedEpisodeAndSkipUnavailableEpisodes() {
        val videos = listOf(
            VideoItem("s1e1", season = 1, episode = 1, released = "2026-01-01"),
            VideoItem("s1e2", season = 1, episode = 2, released = "2026-01-01"),
            VideoItem("future", season = 1, episode = 3, released = "2027-01-01"),
            VideoItem("s2e1", season = 2, episode = 1, released = "2026-01-01"),
        )

        assertEquals(
            listOf("s1e1", "s1e2"),
            seasonWatchVideos(videos, 1, today = "2026-06-01").map(VideoItem::id),
        )
    }

    @Test
    fun detailsResumeUnfinishedMovies() {
        val movie = CatalogItem("movie", "movie", "Movie")
        val unfinished = progress("movie", "movie", position = 30_000, type = "movie")

        assertEquals(unfinished, latestUnfinishedProgress(listOf(unfinished), movie))
        assertEquals("Resume", detailsPlayLabel(movie, unfinished, null))
        assertEquals("Play", detailsPlayLabel(movie, unfinished.copy(watched = true), null))
    }

    @Test
    fun detailsResumeSeriesWithEpisodeNumber() {
        val series = CatalogItem("show", "series", "Show")
        val unfinished = progress("s1e2", "show", position = 30_000)
        val episode = VideoItem("s1e2", season = 1, episode = 2)

        assertEquals(unfinished, latestUnfinishedProgress(listOf(unfinished), series))
        assertEquals("Resume S1E2", detailsPlayLabel(series, unfinished, episode))
        assertEquals("Play S1E3", detailsPlayLabel(series, unfinished, VideoItem("s1e3", season = 1, episode = 3)))
    }

    @Test
    fun detailsResumePrefersCanonicalCoordinatesOverRawVideoId() {
        val series = CatalogItem("show", "series", "Show")
        val unfinished = progress("old-id", "show", position = 30_000)
            .copy(season = 2, episode = 4)

        assertEquals(
            "new-id",
            detailsPlayTarget(
                series,
                listOf(unfinished),
                listOf(
                    VideoItem("old-id", season = 1, episode = 1),
                    VideoItem("new-id", season = 2, episode = 4),
                ),
            ).video?.id,
        )
        assertEquals(
            "Resume S2E4",
            detailsPlayTarget(
                series,
                listOf(unfinished),
                listOf(VideoItem("new-id", season = 2, episode = 4)),
            ).label,
        )
    }

    @Test
    fun detailsUseNextUpAfterTheLastFinishedEpisode() {
        val series = CatalogItem("show", "series", "Show")
        val completed = progress("s1e2", "show", watched = true).copy(updatedAt = "2026-08-12T12:00:00Z")
        val next = VideoItem("s1e3", season = 1, episode = 3)

        assertEquals(
            DetailsPlayTarget(next, "Next Up • S1E3"),
            detailsPlayTarget(series, listOf(completed), listOf(VideoItem("s1e2", season = 1, episode = 2), next)),
        )
    }

    @Test
    fun detailsUseTheFurthestCompletedEpisodeInsteadOfTheLatestTimestamp() {
        val series = CatalogItem("show", "series", "Show")
        val first = progress("s1e1", watched = true).copy(updatedAt = "2026-08-12T12:00:00Z")
        val furthest = progress("s1e3", episode = 3, watched = true).copy(updatedAt = "2026-08-10T12:00:00Z")
        val next = VideoItem("s1e4", season = 1, episode = 4)

        assertEquals(
            DetailsPlayTarget(next, "Next Up • S1E4"),
            detailsPlayTarget(
                series,
                listOf(first, furthest),
                listOf(
                    VideoItem("s1e1", season = 1, episode = 1),
                    VideoItem("s1e3", season = 1, episode = 3),
                    next,
                ),
            ),
        )
    }

    @Test
    fun rawIdOnlyCompletedProgressStillAdvances() {
        val series = CatalogItem("show", "series", "Show")
        val completed = progress("s1e1", watched = true).copy(season = null, episode = null)

        assertEquals(
            "s1e2",
            detailsPlayTarget(
                series,
                listOf(completed),
                listOf(
                    VideoItem("s1e1", season = 1, episode = 1),
                    VideoItem("s1e2", season = 1, episode = 2),
                ),
            ).video?.id,
        )
    }

    @Test
    fun fullyCaughtUpIgnoresMetadataDefault() {
        val series = CatalogItem("show", "series", "Show")
        val videos = listOf(
            VideoItem("s1e1", season = 1, episode = 1),
            VideoItem("s1e2", season = 1, episode = 2),
        )
        val watched = videos.map { progress(it.id, episode = it.episode ?: 1, watched = true) }

        assertEquals(DetailsPlayTarget(null, "Play"), detailsPlayTarget(series, watched, videos, defaultVideoId = "s1e2"))
    }

    @Test
    fun staleUnfinishedProgressDoesNotBeatNewerCompletion() {
        val series = CatalogItem("show", "series", "Show")
        val stale = progress("s1e1", watched = false, position = 20_000).copy(updatedAt = "2026-08-10T12:00:00Z")
        val completed = progress("s1e2", episode = 2, watched = true).copy(updatedAt = "2026-08-12T12:00:00Z")

        assertEquals(
            "s1e3",
            detailsPlayTarget(
                series,
                listOf(stale, completed),
                listOf(
                    VideoItem("s1e1", season = 1, episode = 1),
                    VideoItem("s1e2", season = 1, episode = 2),
                    VideoItem("s1e3", season = 1, episode = 3),
                ),
            ).video?.id,
        )
    }

    @Test
    fun detailsUseMetadataDefaultBeforeFirstEpisode() {
        val series = CatalogItem("show", "series", "Show")
        val default = VideoItem("s1e5", season = 1, episode = 5)

        assertEquals(
            DetailsPlayTarget(default, "Play S1E5"),
            detailsPlayTarget(
                series,
                emptyList(),
                listOf(VideoItem("s1e1", season = 1, episode = 1), default),
                defaultVideoId = default.id,
            ),
        )
    }

    @Test
    fun oneSecondOfSeriesProgressOffersResume() {
        val series = CatalogItem("show", "series", "Show")
        val episode = VideoItem("s1e1", season = 1, episode = 1)
        val unfinished = progress(episode.id, position = 1_000)

        assertEquals(
            DetailsPlayTarget(episode, "Resume S1E1"),
            detailsPlayTarget(series, listOf(unfinished), listOf(episode)),
        )
    }

    @Test
    fun zeroProgressDoesNotOfferResume() {
        val movie = CatalogItem("movie", "movie", "Movie")
        val notStarted = progress("movie", "movie", position = 0, type = "movie")

        assertEquals(null, latestUnfinishedProgress(listOf(notStarted), movie))
        assertEquals("Play", detailsPlayLabel(movie, null, null))
    }

    @Test
    fun savedAutoResumeSourceRequiresExactUnfinishedMediaProgress() {
        val movie = CatalogItem("movie", "movie", "Movie")
        val source = PlaybackSource("addon-1", "url:https://example.com/movie.mp4", "url")
        val saved = progress("movie", "movie", type = "movie", position = 30_000).copy(playbackSource = source)

        assertEquals(source, savedAutoResumeSource(listOf(saved), movie, "movie"))
        assertEquals(null, savedAutoResumeSource(listOf(saved.copy(watched = true)), movie, "movie"))
        assertEquals(null, savedAutoResumeSource(listOf(saved.copy(positionMs = 0)), movie, "movie"))
        assertEquals(null, savedAutoResumeSource(listOf(saved), CatalogItem("other", "movie", "Other"), "movie"))
        assertEquals(null, savedAutoResumeSource(listOf(saved), movie, "other"))
    }

    @Test
    fun savedAutoResumeSourceMatchesCanonicalEpisodeCoordinates() {
        val series = CatalogItem("show", "series", "Show")
        val source = PlaybackSource("addon-1", "url:https://example.com/episode.mp4", "url")
        val saved = progress("legacy-id", "show", position = 30_000)
            .copy(season = 2, episode = 4, playbackSource = source)
        val canonical = VideoItem("canonical-id", season = 2, episode = 4)

        assertEquals(source, savedAutoResumeSource(listOf(saved), series, canonical.id, canonical))
    }

    @Test
    fun savedPlaybackSourceCarriesForwardFromTheNearestEarlierEpisode() {
        val series = CatalogItem("show", "series", "Show")
        val oldSource = PlaybackSource("addon-1", "url:https://example.com/s1e1.mp4", "url", bingeGroup = "release-1080p")
        val recentSource = PlaybackSource("addon-1", "url:https://example.com/s1e2.mp4", "url", bingeGroup = "release-1080p")
        val videos = listOf(
            VideoItem("s1e1", season = 1, episode = 1),
            VideoItem("s1e2", season = 1, episode = 2),
            VideoItem("s1e3", season = 1, episode = 3),
        )
        val progress = listOf(
            progress("s1e1", watched = true).copy(playbackSource = oldSource),
            progress("s1e2", episode = 2, watched = true).copy(playbackSource = recentSource),
        )

        assertEquals(recentSource, savedPlaybackSourceForVideo(progress, series, videos, "s1e3"))
    }

    @Test
    fun explicitHistoryEpisodeWinsAndMissingEpisodeFallsBackToLatestUnfinished() {
        val series = CatalogItem("show", "series", "Show")
        val unfinished = progress("s1e2", "show", position = 30_000)

        assertEquals("s1e3", effectiveResumeVideoId("s1e3", listOf(unfinished), series))
        assertEquals("s1e2", effectiveResumeVideoId(null, listOf(unfinished), series))
    }

    @Test
    fun requestedEpisodeReplacesPreviouslySelectedEpisode() {
        val episodes = listOf(
            VideoItem("s3e4", season = 3, episode = 4),
            VideoItem("s3e10", season = 3, episode = 10),
        )

        val transition = reconcileRequestedVideo(
            current = episodes.first(),
            videos = episodes,
            requestedVideoId = "s3e10",
        )

        assertEquals("s3e10", transition.video?.id)
        assertTrue(transition.shouldResetPlayback)
    }

    @Test
    fun resolvingInitialEpisodeDoesNotResetUnselectedDetailsPlayback() {
        val transition = reconcileRequestedVideo(
            current = null,
            videos = listOf(VideoItem("s3e10", season = 3, episode = 10)),
            requestedVideoId = "s3e10",
        )

        assertEquals("s3e10", transition.video?.id)
        assertFalse(transition.shouldResetPlayback)
    }

    @Test
    fun effectiveProgressEpisodeReplacesExistingSelection() {
        val series = CatalogItem("show", "series", "Show")
        val episodes = listOf(
            VideoItem("s3e4", season = 3, episode = 4),
            VideoItem("s3e10", season = 3, episode = 10),
        )
        val latestProgress = progress("s3e10", "show", position = 30_000)

        val transition = reconcileRequestedVideo(
            current = episodes.first(),
            videos = episodes,
            requestedVideoId = effectiveResumeVideoId(null, listOf(latestProgress), series),
        )

        assertEquals("s3e10", transition.video?.id)
        assertTrue(transition.shouldResetPlayback)
    }

    @Test
    fun requestedEpisodeCanResolveFromCanonicalProgressCoordinates() {
        val episodes = listOf(
            VideoItem("old-s3e10", season = 1, episode = 1),
            VideoItem("new-s3e4", season = 3, episode = 4),
            VideoItem("new-s3e10", season = 3, episode = 10),
        )
        val requestedProgress = progress("old-s3e10", "show", position = 30_000)
            .copy(season = 3, episode = 10)

        assertEquals(
            "new-s3e10",
            resolveRequestedVideo(episodes, "old-s3e10", requestedProgress)?.id,
        )
    }

    @Test
    fun missingCanonicalSeasonFallsBackToFirstPlayableRegularEpisode() {
        val requestedProgress = progress("old-s9e1", "show", position = 30_000)
            .copy(season = 9, episode = 1)
        val episodes = listOf(
            VideoItem("special", season = 0, episode = 1),
            VideoItem("unavailable", season = 1, episode = 1, available = false),
            VideoItem("first-playable", season = 1, episode = 2),
        )

        assertEquals(
            "first-playable",
            resolveRequestedVideo(episodes, "old-s9e1", requestedProgress)?.id,
        )
    }

    @Test
    fun unfinishedProgressWithoutEpisodeMetadataFallsBackToFirstSeriesEpisode() {
        val series = CatalogItem("show", "series", "Show")
        val unfinished = progress("legacy-progress-id", "show", position = 30_000)
            .copy(season = null, episode = null)
        val episodes = listOf(
            VideoItem("s1e1", season = 1, episode = 1),
            VideoItem("s1e2", season = 1, episode = 2),
        )

        assertEquals(
            "s1e1",
            detailsPlayTarget(series, listOf(unfinished), episodes).video?.id,
        )
    }

    private fun progress(
        videoId: String,
        mediaId: String = "show",
        watched: Boolean = false,
        position: Long = 0,
        type: String = "series",
        episode: Int? = if (type == "series") videoId.substringAfter("e").toIntOrNull() else null,
    ) =
        ProgressSummary(
            videoId,
            type,
            mediaId,
            "Title",
            season = if (type == "series") 1 else null,
            episode = episode,
            positionMs = position,
            durationMs = 100_000,
            watched = watched,
            updatedAt = "2026-01-01",
        )
}
