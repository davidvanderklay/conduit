export const fullMetadataFixture = {
  id: "tt-full",
  type: "series",
  name: "A Complete Series",
  poster: "https://images.example/poster.jpg",
  background: "https://images.example/background.jpg",
  logo: "https://images.example/logo.png",
  description: "A fully described series.",
  year: 2026,
  runtime: "48 min",
  imdbRating: 8.7,
  certification: "TV-MA",
  genres: ["Drama", "Mystery"],
  director: ["Ada Director"],
  cast: ["Casey Lead", "Robin Guest"],
  writers: "Wren Writer, Pat Author",
  country: "US",
  awards: "Winner of a very tasteful award.",
  trailerStreams: [{ title: "Official trailer", youtubeId: "abcDEF_1234" }],
  videos: [
    {
      id: "tt-full:1:1",
      season: 1,
      episode: 1,
      title: "The Beginning",
      overview: "Everything begins here.",
      thumbnail: "https://images.example/episode-1.jpg",
      released: "2026-01-02T00:00:00.000Z",
      runtime: "49 min",
      available: true,
    },
  ],
}

export const partialMetadataFixture = {
  id: "tt-partial",
  name: "Partial",
  videos: [{ id: "tt-partial:1:1", episode: 1 }],
}

export const malformedMetadataFixture = {
  id: "\0",
  type: {},
  name: null,
  poster: "javascript:alert(1)",
  background: "data:text/html,bad",
  genres: ["Drama", null, {}, " Drama "],
  director: "One Director, Two Director",
  imdbRating: { unsafe: true },
  trailerStreams: [{ youtubeId: "no spaces allowed" }, null],
  videos: [
    null,
    { id: "", title: "Missing ID" },
    {
      id: "safe:1",
      title: "<b>Displayed as text</b>",
      season: "1",
      episode: "2",
      thumbnail: "file:///private/image.jpg",
      released: "sometime",
    },
  ],
}
