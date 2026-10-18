# Implied Automation, step 5: does the "expectation gap" predict AI stocks?
# Signal for each company and month: how much AI growth the market prices in (from the OCaml reverse DCF)
# minus how much automation is really happening in the jobs that company sells into (from the Stan model).
# A positive gap means the market expects more than the data shows so far.
# Tests (all frequentist, with standard errors that allow for overlapping 3-month returns):
#   Fama-MacBeth cross-sectional slopes with Newey-West t-stats
#   Pooled regression with standard errors clustered by company and by month
#   A long-short portfolio: low-gap thirds minus high-gap thirds
#   The information coefficient (rank correlation of signal and next return)
# Run from the project folder:  Rscript quant/R/gap_test.R

suppressPackageStartupMessages(library(sandwich))
source("analysis/utils.R")
d <- read.csv("quant/out/signal_panel.csv")
d <- d[is.finite(d$signal) & is.finite(d$fwd_excess), ]
d$date <- as.Date(d$date)
nw_t <- function(x, lag = 3) { m <- lm(x ~ 1); unname(coef(m) / sqrt(NeweyWest(m, lag = lag, prewhite = FALSE)[1, 1])) }

# Fama-MacBeth
months <- split(d, d$date)
fm <- do.call(rbind, lapply(months, function(m) {
  if (nrow(m) < 6) return(NULL)
  data.frame(date = m$date[1], slope = coef(lm(fwd_excess ~ scale(signal)[, 1], data = m))[2],
             ic = suppressWarnings(cor(m$signal, m$fwd_excess, method = "spearman")),
             ls = mean(m$fwd_excess[m$signal <= quantile(m$signal, 1 / 3)]) - mean(m$fwd_excess[m$signal >= quantile(m$signal, 2 / 3)]))
}))
fama <- list(months = nrow(fm), mean_slope = mean(fm$slope), nw_t = nw_t(fm$slope))
ic <- list(mean_ic = mean(fm$ic, na.rm = TRUE), nw_t = nw_t(fm$ic[!is.na(fm$ic)]), share_positive = mean(fm$ic > 0, na.rm = TRUE))
ls <- list(mean_3m = mean(fm$ls), yearly = mean(fm$ls) * 4, nw_t = nw_t(fm$ls), hit_rate = mean(fm$ls > 0))

# Pooled, two-way clustered
pooled <- lm(fwd_excess ~ signal, data = d)
vc <- vcovCL(pooled, cluster = ~ sym + date)
pb <- coef(pooled)["signal"]; pse <- sqrt(vc["signal", "signal"])
pool <- list(slope = unname(pb), se_two_way = unname(pse), t = unname(pb / pse), obs = nrow(d), companies = length(unique(d$sym)))

cat(sprintf("Company-months: %d across %d companies and %d months\n", nrow(d), pool$companies, fama$months))
cat(sprintf("Fama-MacBeth slope per 1 SD of gap: %+.2f%% per 3 months (Newey-West t = %.2f)\n", 100 * fama$mean_slope, fama$nw_t))
cat(sprintf("Pooled slope: %+.4f (two-way clustered t = %.2f)\n", pool$slope, pool$t))
cat(sprintf("Information coefficient: %+.3f (t = %.2f), positive in %.0f%% of months\n", ic$mean_ic, ic$nw_t, 100 * ic$share_positive))
cat(sprintf("Long low-gap / short high-gap: %+.2f%% per 3 months, %+.1f%% a year (t = %.2f), wins %.0f%% of months\n",
            100 * ls$mean_3m, 100 * ls$yearly, ls$nw_t, 100 * ls$hit_rate))
verdict <- if (abs(fama$nw_t) >= 2 && abs(pool$t) >= 2) "significant" else "not significant"
cat("Verdict:", verdict, "at the usual 5% level\n")
fm$date <- format(fm$date)
writeLines(to_json(list(fama_macbeth = fama, pooled = pool, ic = ic, long_short = ls, verdict = verdict,
                        monthly = fm[, c("date", "ls", "ic")])), "quant/out/gap_test.json")
cat("Saved quant/out/gap_test.json\n")
