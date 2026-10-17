package hedgemyjob;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Runs the trend signal backtest in Java and checks it gives the same answer as the Python version.
 * Run from the project folder:  java java/src/hedgemyjob/Main.java
 */
public class Main {
    public static void main(String[] args) throws Exception {
        long t0 = System.nanoTime();
        PriceTable table = PriceTable.load(Path.of("data", "raw", "prices.csv"));
        Backtester bt = new Backtester(table, "SPY");
        Map<String, GroupStats> groups = bt.run(LocalDate.of(2021, 1, 1));
        double ms = (System.nanoTime() - t0) / 1e6;

        System.out.printf("Loaded %d days of prices. Backtest ran in %.0f ms.%n%n", table.size(), ms);
        System.out.printf("%-16s %8s %16s %18s %18s%n", "Signal", "Times", "Beat market %", "Avg 3m return %", "Vs market %");
        StringBuilder json = new StringBuilder("{\n  \"engine\": \"Java\",\n  \"groups\": [\n");
        int k = 0;
        for (GroupStats g : groups.values()) {
            System.out.printf(Locale.US, "%-16s %8d %16.1f %18.1f %18.1f%n",
                g.label(), g.times(), g.beatMarketPct(), g.avgReturnPct(), g.avgExcessPct());
            json.append(String.format(Locale.US,
                "    {\"label\": \"%s\", \"times\": %d, \"beat_market_pct\": %.2f, \"avg_3m_return_pct\": %.2f, \"avg_vs_market_pct\": %.2f}%s%n",
                g.label(), g.times(), g.beatMarketPct(), g.avgReturnPct(), g.avgExcessPct(), ++k < groups.size() ? "," : ""));
        }
        json.append("  ]\n}\n");
        Files.writeString(Path.of("analysis", "java_signals.json"), json.toString());

        compareWithPython(groups, Path.of("docs", "data", "signals.json"));
    }

    /** Reads the Python results and checks each group matches. */
    static void compareWithPython(Map<String, GroupStats> groups, Path pythonJson) throws Exception {
        if (!Files.exists(pythonJson)) {
            System.out.println("\nPython results not found, skipping the check.");
            return;
        }
        String text = Files.readString(pythonJson);
        Pattern p = Pattern.compile("\"label\":\\s*\"([^\"]+)\",\\s*\"times\":\\s*(\\d+),\\s*\"beat_market_pct\":\\s*([-\\d.]+),"
            + "\\s*\"avg_3m_return_pct\":\\s*([-\\d.]+),\\s*\"avg_vs_market_pct\":\\s*([-\\d.]+)");
        Matcher m = p.matcher(text);
        boolean allMatch = true;
        System.out.println("\nCheck against the Python engine:");
        while (m.find()) {
            GroupStats g = groups.get(m.group(1));
            if (g == null) {
                continue;
            }
            boolean same = g.times() == Integer.parseInt(m.group(2))
                && Math.abs(g.beatMarketPct() - Double.parseDouble(m.group(3))) <= 0.6
                && Math.abs(g.avgReturnPct() - Double.parseDouble(m.group(4))) <= 0.06
                && Math.abs(g.avgExcessPct() - Double.parseDouble(m.group(5))) <= 0.06;
            allMatch &= same;
            System.out.printf("  %-16s %s%n", g.label(), same ? "matches" : "DIFFERENT");
        }
        System.out.println(allMatch ? "Java and Python agree." : "Java and Python disagree, worth a look.");
    }
}
