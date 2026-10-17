# HedgeMyJob quant analytics in R, using the same tools quant and risk teams use
#   xts                  time series of daily prices
#   PerformanceAnalytics fund-style statistics: Sharpe ratio, drawdown, beta, volatility
# Compares each AI stock basket with the S&P 500 since ChatGPT came out (Nov 30, 2022).
# Run from the project folder:  Rscript analysis/quant.R

# Install packages into your own user folder, since Program Files needs admin rights
user_lib <- Sys.getenv("R_LIBS_USER")
dir.create(user_lib, recursive = TRUE, showWarnings = FALSE)
.libPaths(c(user_lib, .libPaths()))
for (pkg in c("xts", "PerformanceAnalytics")) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    install.packages(pkg, lib = user_lib, repos = "https://cloud.r-project.org")
  }
}
suppressPackageStartupMessages({
  library(xts)
  library(PerformanceAnalytics)
})
source("analysis/utils.R")

START <- "2022-11-30"
RISK_FREE_YEARLY <- 0.045  # rough average 3-month Treasury bill rate over the period
rf_daily <- (1 + RISK_FREE_YEARLY)^(1 / 252) - 1

raw <- read.csv("data/raw/prices.csv", check.names = FALSE)
prices <- xts(raw[, -1], order.by = as.Date(raw[[1]]))
prices <- prices[index(prices) >= as.Date(START)]
rets <- na.omit(Return.calculate(prices, method = "discrete"))
market <- rets[, "SPY"]
cat("Daily returns:", nrow(rets), "days for", ncol(rets), "tickers\n")

baskets <- read.csv("data/processed/baskets_for_r.csv", stringsAsFactors = FALSE)

stats_for <- function(r, name) {
  r <- na.omit(r)
  data.frame(
    name = name,
    yearly_return = round(as.numeric(Return.annualized(r)) * 100, 1),
    yearly_volatility = round(as.numeric(StdDev.annualized(r)) * 100, 1),
    sharpe = round(as.numeric(SharpeRatio.annualized(r, Rf = rf_daily)), 2),
    max_drawdown = round(as.numeric(maxDrawdown(r)) * 100, 1),
    beta_vs_market = round(as.numeric(CAPM.beta(r, market[index(r)])), 2),
    stringsAsFactors = FALSE
  )
}

# Equal-weight baskets, rebalanced back to equal weights every month
basket_returns <- list()
for (b in unique(baskets$basket)) {
  tick <- intersect(baskets$ticker[baskets$basket == b], colnames(rets))
  if (length(tick) == 0) next
  w <- rep(1 / length(tick), length(tick))
  basket_returns[[b]] <- Return.portfolio(rets[, tick], weights = w, rebalance_on = "months")
}
basket_table <- do.call(rbind, c(
  lapply(names(basket_returns), function(b) stats_for(basket_returns[[b]], b)),
  list(stats_for(market, "S&P 500"))
))
cat("\nBaskets vs the S&P 500 since", START, "\n")
print(basket_table, row.names = FALSE)

stock_table <- do.call(rbind, lapply(setdiff(colnames(rets), "SPY"), function(t) stats_for(rets[, t], t)))
stock_table <- stock_table[order(-stock_table$sharpe), ]
cat("\nEach AI stock, best Sharpe ratio first\n")
print(stock_table, row.names = FALSE)

# Growth of $1 and drawdowns, the standard fund chart
all_series <- do.call(merge, c(basket_returns, list(market)))
colnames(all_series) <- c(names(basket_returns), "S&P 500")
png("analysis/quant_performance.png", width = 1300, height = 950, res = 140)
charts.PerformanceSummary(all_series, main = "AI stock baskets vs the S&P 500 since ChatGPT",
                          colorset = c("#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#6250d6", "#52514e"),
                          legend.loc = "topleft", wealth.index = TRUE)
dev.off()

results <- list(
  start = START,
  risk_free_yearly_pct = RISK_FREE_YEARLY * 100,
  baskets = basket_table,
  stocks = stock_table
)
writeLines(to_json(results), "analysis/quant.json")
dir.create("docs/data", showWarnings = FALSE, recursive = TRUE)
file.copy("analysis/quant.json", "docs/data/quant.json", overwrite = TRUE)
file.copy("analysis/quant_performance.png", "docs/data/quant_performance.png", overwrite = TRUE)
cat("\nSaved analysis/quant.json, docs/data/quant.json and analysis/quant_performance.png\n")
