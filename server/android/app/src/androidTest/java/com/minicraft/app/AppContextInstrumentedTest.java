package com.minicraft.app;

import static org.junit.Assert.assertEquals;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * 冒烟：装上的确实是我们的包。
 *
 * <p>这条是 Capacitor 模板自带的（`ExampleInstrumentedTest`），它硬编码了模板的
 * `com.getcapacitor.app`，改了 `appId` 之后必红——第一次 `connectedDebugAndroidTest`
 * 就撞上了。留着这条（改成断言自己的包名），比删掉有用：它能证明"装上去的是这一版"。
 */
@RunWith(AndroidJUnit4.class)
public class AppContextInstrumentedTest {

    @Test
    public void packageNameMatchesApplicationId() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.minicraft.app", context.getPackageName());
    }
}
