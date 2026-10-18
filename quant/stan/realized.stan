// Implied Automation, step 4: how much automation is ACTUALLY happening, job by job.
// Employment change from May 2022 (before ChatGPT) to May 2025, explained by:
//   a trend for each job family (partially pooled, so small families borrow strength from the rest)
//   plus delta times how much people really use AI for that job's tasks.
// Student-t errors keep a few odd jobs from dragging the estimate; big jobs are measured more precisely.
data {
  int<lower=1> N;                       // jobs
  int<lower=1> G;                       // job families (2-digit SOC)
  array[N] int<lower=1, upper=G> fam;
  vector[N] y;                          // log(employment 2025 / employment 2022)
  vector[N] u;                          // real AI usage index, centred
  vector<lower=0>[N] w;                 // relative size of the job
}
parameters {
  real mu0;
  real<lower=0> tau;
  vector[G] z;                          // non-centred family effects
  real delta;                           // change in log employment per unit of AI usage
  real<lower=0> sigma;
  real<lower=1> nu;
}
transformed parameters {
  vector[G] mu = mu0 + tau * z;
}
model {
  mu0 ~ normal(0, 0.2);
  tau ~ normal(0, 0.2);
  z ~ std_normal();
  delta ~ normal(0, 0.5);
  sigma ~ normal(0, 0.3);
  nu ~ gamma(2, 0.1);
  y ~ student_t(nu, mu[fam] + delta * u, sigma ./ sqrt(w));
}
generated quantities {
  vector[N] ai_effect = delta * u;      // the part of each job's employment change linked to AI use
  vector[N] y_rep;
  for (n in 1:N) y_rep[n] = student_t_rng(nu, mu[fam[n]] + delta * u[n], sigma / sqrt(w[n]));
}
