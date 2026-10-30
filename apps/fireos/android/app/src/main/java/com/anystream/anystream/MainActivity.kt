package com.anystream.anystream

import android.view.KeyEvent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "AnyStream"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
   * react-native-tvos 0.83 only turns remote keys into `onHWKeyEvent` (what `useTVEventHandler` listens to)
   * inside the old-architecture ReactRootView; the bridgeless ReactSurfaceView this app uses does not, so
   * play/pause, skip and Menu never reached the player. Emit the same event from the activity instead, with
   * the names and key actions the root view would have used. Back is not in the map and keeps its normal path.
   */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val name = KEY_EVENTS_ACTIONS[event.keyCode]
    if (name != null && (event.action == KeyEvent.ACTION_DOWN || event.action == KeyEvent.ACTION_UP)) {
      val context = (application as ReactApplication).reactHost?.currentReactContext
      if (context != null) {
        val data = Arguments.createMap()
        data.putString("eventType", name)
        data.putInt("eventKeyAction", event.action)
        context.emitDeviceEvent("onHWKeyEvent", data)
      }
    }
    return super.dispatchKeyEvent(event)
  }

  private companion object {
    /** The same table as React Native's ReactAndroidHWInputDeviceHelper. */
    val KEY_EVENTS_ACTIONS: Map<Int, String> =
        mapOf(
            KeyEvent.KEYCODE_DPAD_CENTER to "select",
            KeyEvent.KEYCODE_ENTER to "select",
            KeyEvent.KEYCODE_SPACE to "select",
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE to "playPause",
            KeyEvent.KEYCODE_MEDIA_PLAY to "play",
            KeyEvent.KEYCODE_MEDIA_PAUSE to "pause",
            KeyEvent.KEYCODE_MEDIA_REWIND to "rewind",
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD to "fastForward",
            KeyEvent.KEYCODE_MEDIA_STOP to "stop",
            KeyEvent.KEYCODE_MEDIA_NEXT to "next",
            KeyEvent.KEYCODE_MEDIA_PREVIOUS to "previous",
            KeyEvent.KEYCODE_DPAD_UP to "up",
            KeyEvent.KEYCODE_DPAD_RIGHT to "right",
            KeyEvent.KEYCODE_DPAD_DOWN to "down",
            KeyEvent.KEYCODE_DPAD_LEFT to "left",
            KeyEvent.KEYCODE_INFO to "info",
            KeyEvent.KEYCODE_MENU to "menu",
        )
  }
}
