package media.conduit.client.account

import io.ktor.client.HttpClient
import io.ktor.client.engine.js.Js
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

actual fun createPlatformHttpClient(): HttpClient = HttpClient(Js) {
    expectSuccess = false
    install(HttpTimeout) {
        connectTimeoutMillis = 5_000
        requestTimeoutMillis = 10_000
    }
    install(ContentNegotiation) {
        json(Json { ignoreUnknownKeys = true })
    }
}
