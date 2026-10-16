package io.chintu.aninewshub;

import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.widget.CompoundButton;
import android.widget.TextView;

final class BrandTheme {
    static final int BACKGROUND = Color.rgb(23, 21, 18);
    static final int SURFACE = Color.rgb(34, 31, 27);
    static final int SURFACE_RAISED = Color.rgb(43, 38, 32);
    static final int BORDER = Color.rgb(59, 52, 44);
    static final int BORDER_STRONG = Color.rgb(90, 78, 65);
    static final int TEXT = Color.rgb(242, 236, 223);
    static final int MUTED = Color.rgb(193, 182, 165);
    static final int FAINT = Color.rgb(151, 139, 121);
    static final int ACCENT = Color.rgb(240, 120, 88);
    static final int ACCENT_SOFT = Color.argb(34, 240, 120, 88);

    static final class Palette {
        final int background;
        final int surface;
        final int border;
        final int borderStrong;
        final int text;
        final int muted;
        final int accent;
        final int accentSoft;

        Palette(boolean light) {
            if (light) {
                background = Color.rgb(242, 237, 227);
                surface = Color.rgb(251, 248, 240);
                border = Color.rgb(215, 203, 187);
                borderStrong = Color.rgb(184, 167, 145);
                text = Color.rgb(40, 35, 30);
                muted = Color.rgb(95, 85, 73);
                accent = Color.rgb(169, 61, 42);
                accentSoft = Color.argb(23, 169, 61, 42);
            } else {
                background = BACKGROUND;
                surface = SURFACE;
                border = BORDER;
                borderStrong = BORDER_STRONG;
                text = TEXT;
                muted = MUTED;
                accent = ACCENT;
                accentSoft = ACCENT_SOFT;
            }
        }
    }

    private BrandTheme() {}

    static GradientDrawable panel(boolean selected, float radiusDp, float density) {
        return panel(selected, radiusDp, density, new Palette(false));
    }

    static GradientDrawable panel(boolean selected, float radiusDp, float density, Palette palette) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(selected ? palette.accentSoft : palette.surface);
        background.setCornerRadius(radiusDp * density);
        background.setStroke(Math.max(1, Math.round(density)), selected ? palette.accent : palette.border);
        return background;
    }

    static void styleCheckBox(CompoundButton checkbox) {
        styleCheckBox(checkbox, new Palette(false));
    }

    static void styleCheckBox(CompoundButton checkbox, Palette palette) {
        int[][] states = new int[][] {
                new int[] { android.R.attr.state_checked },
                new int[] {}
        };
        int[] colors = new int[] { palette.accent, palette.borderStrong };
        checkbox.setButtonTintList(new ColorStateList(states, colors));
    }

    static void styleAction(TextView button, boolean primary, float density) {
        styleAction(button, primary, density, new Palette(false));
    }

    static void styleAction(TextView button, boolean primary, float density, Palette palette) {
        int fill = primary ? palette.accent : palette.surface;
        int stroke = primary ? palette.accent : palette.borderStrong;
        int text = primary ? palette.background : palette.accent;
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(fill);
        shape.setCornerRadius(5 * density);
        shape.setStroke(Math.max(1, Math.round(density)), stroke);
        button.setBackground(new RippleDrawable(ColorStateList.valueOf(0x22ffffff), shape, null));
        button.setTextColor(text);
        button.setTextSize(15);
        button.setTypeface(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD);
        button.setPadding(Math.round(18 * density), Math.round(11 * density),
                Math.round(18 * density), Math.round(11 * density));
        button.setGravity(android.view.Gravity.CENTER);
        button.setClickable(true);
        button.setFocusable(true);
    }
}
