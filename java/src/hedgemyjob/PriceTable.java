package hedgemyjob;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Daily closing prices for every ticker, one row per trading day.
 * Missing prices are stored as NaN so they never count as real numbers.
 */
public class PriceTable {
    private final List<LocalDate> dates = new ArrayList<>();
    private final Map<String, double[]> prices = new LinkedHashMap<>();

    /** Reads the prices.csv file made by download_data.py. */
    public static PriceTable load(Path csv) throws IOException {
        List<String> lines = Files.readAllLines(csv);
        String[] header = lines.get(0).split(",", -1);
        PriceTable table = new PriceTable();
        int rows = lines.size() - 1;
        for (int c = 1; c < header.length; c++) {
            table.prices.put(header[c].trim(), new double[rows]);
        }
        for (int r = 0; r < rows; r++) {
            String[] cells = lines.get(r + 1).split(",", -1);
            table.dates.add(LocalDate.parse(cells[0].trim().substring(0, 10)));
            for (int c = 1; c < header.length; c++) {
                String cell = c < cells.length ? cells[c].trim() : "";
                table.prices.get(header[c].trim())[r] = cell.isEmpty() ? Double.NaN : Double.parseDouble(cell);
            }
        }
        return table;
    }

    public List<LocalDate> dates() {
        return dates;
    }

    public double[] series(String ticker) {
        return prices.get(ticker);
    }

    public Iterable<String> tickers() {
        return prices.keySet();
    }

    public int size() {
        return dates.size();
    }
}
