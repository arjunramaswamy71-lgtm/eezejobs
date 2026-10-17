package hedgemyjob;

/** Running totals for one signal label in the backtest. */
public class GroupStats {
    private final String label;
    private int times;
    private int beatMarket;
    private double sumReturn;
    private double sumExcess;

    public GroupStats(String label) {
        this.label = label;
    }

    public void add(double forwardReturn, double excess) {
        times++;
        beatMarket += excess > 0 ? 1 : 0;
        sumReturn += forwardReturn;
        sumExcess += excess;
    }

    public String label() {
        return label;
    }

    public int times() {
        return times;
    }

    public double beatMarketPct() {
        return times == 0 ? Double.NaN : 100.0 * beatMarket / times;
    }

    public double avgReturnPct() {
        return times == 0 ? Double.NaN : 100.0 * sumReturn / times;
    }

    public double avgExcessPct() {
        return times == 0 ? Double.NaN : 100.0 * sumExcess / times;
    }
}
