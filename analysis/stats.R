# HedgeMyJob statistics in R
# Questions:
#   1. Did fields with more AI exposure lose more hiring since ChatGPT came out?
#   2. Which source of AI exposure best predicts falling hiring?
#   3. Do the AI models agree with each other?
#   4. Is AI exposure higher for better paid jobs?
# Run from the project folder:  Rscript analysis/stats.R
# Uses base R only, so there is nothing extra to install.

source("analysis/utils.R")
jobs <- read.csv("data/processed/jobs_for_r.csv", stringsAsFactors = FALSE)
jobs$soc_group <- sprintf("%02d", as.integer(jobs$group))
cat("Jobs loaded:", nrow(jobs), "\n")

wmean <- function(x, w) {
  ok <- !is.na(x) & !is.na(w)
  if (!any(ok)) return(NA)
  sum(x[ok] * w[ok]) / sum(w[ok])
}
r3 <- function(x) round(x, 3)

# ---------- 1. Exposure vs hiring, by hiring sector ----------
# Hiring data comes by sector, so average each sector's jobs, weighted by how many people do each job
sec_jobs <- jobs[!is.na(jobs$sector) & !is.na(jobs$employment), ]
sectors <- do.call(rbind, lapply(split(sec_jobs, sec_jobs$sector), function(d) {
  data.frame(
    sector = d$sector[1],
    hiring_change = d$hiring_change[1],
    exposure = wmean(d$exposure_score, d$employment),
    workers = sum(d$employment),
    stringsAsFactors = FALSE
  )
}))
sectors <- sectors[!is.na(sectors$hiring_change) & !is.na(sectors$exposure), ]

m1 <- lm(I(hiring_change * 100) ~ exposure, data = sectors, weights = sqrt(workers))
s1 <- summary(m1)
slope <- coef(s1)["exposure", ]
q1 <- list(
  sectors = nrow(sectors),
  slope_per_10_points = r3(slope["Estimate"] * 10),
  p_value = signif(slope["Pr(>|t|)"], 3),
  r_squared = r3(s1$r.squared),
  correlation = r3(cor(sectors$exposure, sectors$hiring_change))
)
cat("\n1. Sector exposure vs hiring change since Nov 2022\n")
print(q1)

png("analysis/sector_exposure_vs_hiring.png", width = 1100, height = 750, res = 140)
par(mar = c(5, 5, 3, 1))
plot(sectors$exposure, sectors$hiring_change * 100, pch = 19, col = "#2a78d6",
     cex = sqrt(sectors$workers / max(sectors$workers)) * 3 + 0.6,
     xlab = "AI exposure of the sector's jobs (0 to 100, weighted by workers)",
     ylab = "Change in job postings since Nov 2022 (%)",
     main = "More AI-exposed fields vs change in hiring")
abline(m1, col = "#52514e", lwd = 2, lty = 2)
abline(h = 0, col = "grey70")
big <- order(-sectors$workers)[1:12]
text(sectors$exposure[big], sectors$hiring_change[big] * 100, sectors$sector[big], pos = 3, cex = 0.7)
dev.off()

# ---------- 2. Which source predicts hiring best ----------
src_cols <- grep("_pct$", names(jobs), value = TRUE)
src_rows <- lapply(src_cols, function(col) {
  agg <- do.call(rbind, lapply(split(sec_jobs, sec_jobs$sector), function(d)
    data.frame(h = d$hiring_change[1], x = wmean(d[[col]], d$employment))))
  agg <- agg[complete.cases(agg), ]
  if (nrow(agg) < 8) return(NULL)
  ct <- cor.test(agg$x, agg$h)
  data.frame(source = sub("_pct$", "", col), sectors = nrow(agg),
             correlation = r3(unname(ct$estimate)), p_value = signif(ct$p.value, 3))
})
q2 <- do.call(rbind, src_rows)
q2 <- q2[order(q2$correlation), ]
cat("\n2. Which source best tracks falling hiring (more negative = stronger)\n")
print(q2, row.names = FALSE)

# ---------- 3. Do the AI models agree ----------
panel_cols <- grep("^panel_[a-z]+$", names(jobs), value = TRUE)
q3 <- list(models = sub("panel_", "", panel_cols))
if (length(panel_cols) >= 2) {
  pm <- jobs[, panel_cols]
  cm <- cor(pm, use = "pairwise.complete.obs", method = "spearman")
  pairs <- cm[upper.tri(cm)]
  q3$average_rank_agreement <- r3(mean(pairs))
  q3$lowest_pair_agreement <- r3(min(pairs))
  # Average share of a job's tasks each model thinks AI can do, 0 to 100
  q3$average_exposure_by_model <- as.list(round(colMeans(pm, na.rm = TRUE) * 100, 1))
  names(q3$average_exposure_by_model) <- sub("panel_", "", panel_cols)
  q3$rank_correlations <- lapply(seq_len(nrow(cm)), function(i) as.list(r3(cm[i, ])))
  names(q3$rank_correlations) <- rownames(cm)
  cat("\n3. Do the AI models agree?\n")
  print(round(cm, 2))
  cat("Average exposure each model gives a job (0 to 100):\n")
  print(unlist(q3$average_exposure_by_model))
}

# ---------- 4. Pay vs exposure ----------
pay <- jobs[!is.na(jobs$median_wage) & !is.na(jobs$employment), ]
m4 <- lm(log(median_wage) ~ exposure_score, data = pay, weights = employment)
b4 <- coef(summary(m4))["exposure_score", ]
pay$pay_group <- cut(pay$median_wage, quantile(pay$median_wage, 0:5 / 5), include.lowest = TRUE,
                     labels = c("Lowest paid fifth", "Second fifth", "Middle fifth", "Fourth fifth", "Highest paid fifth"))
by_pay <- sapply(split(pay, pay$pay_group), function(d) round(wmean(d$exposure_score, d$employment), 1))
q4 <- list(
  pay_change_per_10_points_pct = r3((exp(b4["Estimate"] * 10) - 1) * 100),
  p_value = signif(b4["Pr(>|t|)"], 3),
  exposure_by_pay_fifth = as.list(by_pay)
)
cat("\n4. Pay vs AI exposure\n")
print(q4)

# ---------- Save results ----------
results <- list(
  exposure_vs_hiring = q1,
  sources_vs_hiring = q2,
  ai_agreement = q3,
  pay_vs_exposure = q4,
  sectors = sectors[order(sectors$exposure, decreasing = TRUE), ]
)
writeLines(to_json(results), "analysis/results.json")
dir.create("docs/data", showWarnings = FALSE, recursive = TRUE)
file.copy("analysis/results.json", "docs/data/research.json", overwrite = TRUE)
file.copy("analysis/sector_exposure_vs_hiring.png", "docs/data/sector_exposure_vs_hiring.png", overwrite = TRUE)
cat("\nSaved analysis/results.json, docs/data/research.json and analysis/sector_exposure_vs_hiring.png\n")
