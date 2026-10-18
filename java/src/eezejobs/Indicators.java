package eezejobs;

/**
 * Basic price indicators. Every method returns an array the same length as the input,
 * with NaN where there isn't enough history yet.
 */
public final class Indicators {
    private Indicators() {
    }

    /** Average of the last n prices. Any missing price in the window makes the result missing. */
    public static double[] movingAverage(double[] p, int n) {
        double[] out = nanArray(p.length);
        for (int i = n - 1; i < p.length; i++) {
            double sum = 0;
            boolean ok = true;
            for (int k = i - n + 1; k <= i && ok; k++) {
                ok = !Double.isNaN(p[k]);
                sum += p[k];
            }
            if (ok) {
                out[i] = sum / n;
            }
        }
        return out;
    }

    /** Price `back` rows ago, or ahead if back is negative. */
    public static double shifted(double[] p, int i, int back) {
        int j = i - back;
        return j >= 0 && j < p.length ? p[j] : Double.NaN;
    }

    /** Return from `from` rows ago to `to` rows ago: p[i - to] / p[i - from] - 1. */
    public static double[] returnBetween(double[] p, int from, int to) {
        double[] out = nanArray(p.length);
        for (int i = 0; i < p.length; i++) {
            out[i] = shifted(p, i, to) / shifted(p, i, from) - 1;
        }
        return out;
    }

    static double[] nanArray(int n) {
        double[] a = new double[n];
        java.util.Arrays.fill(a, Double.NaN);
        return a;
    }
}
