package dev.renuxcord.app;

import android.content.Context;

public class DiscordBranch {
    public static int getRadioButtonId(Context ctx) {
        switch (AppSettings.getBranch(ctx)) {
            case AppSettings.BRANCH_PTB:
                return R.id.branch_ptb;
            case AppSettings.BRANCH_CANARY:
                return R.id.branch_canary;
            default:
                return R.id.branch_stable;
        }
    }

    public static void setFromRadioButtonId(Context ctx, int radioButtonId) {
        String branch;
        if (radioButtonId == R.id.branch_ptb) {
            branch = AppSettings.BRANCH_PTB;
        } else if (radioButtonId == R.id.branch_canary) {
            branch = AppSettings.BRANCH_CANARY;
        } else {
            branch = AppSettings.BRANCH_STABLE;
        }
        AppSettings.setBranch(ctx, branch);
    }

    public static String getWebUrl(Context ctx) {
        switch (AppSettings.getBranch(ctx)) {
            case AppSettings.BRANCH_PTB:
                return "https://ptb.discord.com/";
            case AppSettings.BRANCH_CANARY:
                return "https://canary.discord.com/";
            default:
                return "https://discord.com/";
        }
    }
}
