package eezejobs;

/**
 * The 4-check trend score, the same rules as src/signals.py:
 * 1. price above its 200 day average
 * 2. 50 day average above the 200 day average
 * 3. up over the past 12 months, skipping the latest month
 * 4. beat the market over the last 3 months
 * Score is 0 to 4, or -1 when there isn't enough history.
 */
public class TrendSignal {
    public static final String[] LABELS = {"Downtrend", "Downtrend", "Mixed", "Uptrend", "Strong uptrend"};

    private final int[] score;
    private final boolean[][] checks;

    public TrendSignal(double[] p, double[] market) {
        int n = p.length;
        double[] ma50 = Indicators.movingAverage(p, 50);
        double[] ma200 = Indicators.movingAverage(p, 200);
        double[] momentum = Indicators.returnBetween(p, 252, 21);
        double[] r3 = Indicators.returnBetween(p, 63, 0);
        double[] m3 = Indicators.returnBetween(market, 63, 0);
        score = new int[n];
        checks = new boolean[n][4];
        for (int i = 0; i < n; i++) {
            if (Double.isNaN(ma200[i]) || Double.isNaN(momentum[i])) {
                score[i] = -1;
                continue;
            }
            // Comparisons with NaN are false in Java, same as in pandas
            checks[i][0] = p[i] > ma200[i];
            checks[i][1] = ma50[i] > ma200[i];
            checks[i][2] = momentum[i] > 0;
            checks[i][3] = r3[i] - m3[i] > 0;
            for (boolean c : checks[i]) {
                score[i] += c ? 1 : 0;
            }
        }
    }

    public int score(int i) {
        return score[i];
    }

    public boolean[] checks(int i) {
        return checks[i];
    }

    public static String label(int score) {
        return score < 0 ? "Not enough history" : LABELS[score];
    }
}
