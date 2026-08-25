package media.conduit.client.foundation

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidSecureStoreTest {
    @Test
    fun encryptsRoundTripsAndRemovesSessionValue() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val preferences = context.getSharedPreferences("secure_store_test", 0).apply {
            edit().clear().commit()
        }
        val store = AndroidSecureStore(preferences)

        store.put("session", "not-plain-text")

        assertEquals("not-plain-text", store.get("session"))
        assertFalse(preferences.getString("session", null).orEmpty().contains("not-plain-text"))
        store.remove("session")
        assertNull(store.get("session"))
    }
}
