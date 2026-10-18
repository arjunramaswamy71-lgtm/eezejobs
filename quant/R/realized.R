# Implied Automation, step 4: realized automation, estimated two ways.
#   Frequentist: weighted least squares with family fixed effects and HC3 robust standard errors
#   Bayesian:    the hierarchical Stan model in quant/stan/realized.stan, with convergence and posterior checks
# Run from the project folder:  Rscript quant/R/realized.R
# Reads quant/out/realized_input.csv, writes quant/out/realized.csv and quant/out/realized_summary.json

suppressPackageStartupMessages({ library(rstan); library(sandwich) })
source("analysis/utils.R")   # to_json
options(mc.cores = max(1, parallel::detectCores() - 1))
rstan_options(auto_write = TRUE)

d <- read.csv("quant/out/realized_input.csv", colClasses = c(soc = "character", family = "character"))
d$u_c <- d$usage - mean(d$usage)
cat(sprintf("Jobs: %d, families: %d, median log employment change %.3f\n", nrow(d), length(unique(d$family)), median(d$y)))

# ---- Frequentist ----
ols <- lm(y ~ u_c + factor(family), data = d, weights = w)
vc <- vcovHC(ols, type = "HC3")
b <- coef(ols)["u_c"]; se <- sqrt(vc["u_c", "u_c"])
freq <- list(delta = unname(b), se_hc3 = unname(se), t = unname(b / se),
             p_value = unname(2 * pt(-abs(b / se), df = ols$df.residual)),
             ci95 = unname(b + c(-1, 1) * qt(0.975, ols$df.residual) * se), r_squared = summary(ols)$r.squared)
cat(sprintf("Frequentist WLS + HC3: delta = %.3f (SE %.3f, p = %.3g)\n", freq$delta, freq$se_hc3, freq$p_value))

# ---- Bayesian ----
fam <- as.integer(factor(d$family))
data_list <- list(N = nrow(d), G = max(fam), fam = fam, y = d$y, u = d$u_c, w = d$w)
fit <- stan("quant/stan/realized.stan", data = data_list, chains = 4, iter = 2000, warmup = 1000, seed = 2026, refresh = 0)
s <- summary(fit, pars = c("delta", "mu0", "tau", "sigma", "nu"))$summary
print(round(s[, c("mean", "sd", "2.5%", "97.5%", "n_eff", "Rhat")], 3))
post <- rstan::extract(fit)
eff <- outer(post$delta, d$usage)                       # draws x jobs: effect versus a job nobody uses AI for
yrep <- post$y_rep
inside <- mean(sapply(seq_len(nrow(d)), function(n) { q <- quantile(yrep[, n], c(0.05, 0.95)); d$y[n] >= q[1] && d$y[n] <= q[2] }))
sp <- get_sampler_params(fit, inc_warmup = FALSE)
divergent <- sum(sapply(sp, function(x) sum(x[, "divergent__"])))
bayes <- list(delta_mean = mean(post$delta), delta_sd = sd(post$delta),
              delta_ci90 = unname(quantile(post$delta, c(0.05, 0.95))),
              prob_delta_negative = mean(post$delta < 0),
              tau = mean(post$tau), sigma = mean(post$sigma), nu = mean(post$nu),
              max_rhat = max(summary(fit)$summary[, "Rhat"], na.rm = TRUE),
              min_ess = min(summary(fit)$summary[, "n_eff"], na.rm = TRUE),
              divergent = divergent, ppc_90_coverage = inside)
cat(sprintf("Bayesian: delta = %.3f (90%% interval %.3f to %.3f), P(delta < 0) = %.2f, max Rhat %.3f, divergences %d, PPC 90%% coverage %.2f\n",
            bayes$delta_mean, bayes$delta_ci90[1], bayes$delta_ci90[2], bayes$prob_delta_negative, bayes$max_rhat, divergent, inside))

# Realized automation per job, per year: the employment shortfall linked to AI use, never below zero
years <- 3
# (an automated share of jobs, so the employment effect is flipped in sign and floored at zero)
loss <- -eff; loss[loss < 0] <- 0
out <- data.frame(soc = d$soc,
                  realized_mean = colMeans(loss) / years,
                  realized_lo = apply(loss, 2, quantile, 0.05) / years,
                  realized_hi = apply(loss, 2, quantile, 0.95) / years,
                  emp_change = d$y)
write.csv(out, "quant/out/realized.csv", row.names = FALSE)
writeLines(to_json(list(frequentist = freq, bayesian = bayes, jobs = nrow(d), years = years)), "quant/out/realized_summary.json")
cat("Saved quant/out/realized.csv and quant/out/realized_summary.json\n")
