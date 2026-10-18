% Implied Automation, step 8: the best hedge for each job, in MATLAB / GNU Octave.
%
% Each job's market-implied career value moves every month as the market changes its bet on AI.
% For every job we solve a constrained quadratic program: which mix of the AI stocks that sell into
% that job best offsets those moves?
%     minimise   Var( career return + w' * stock returns )
%     subject to w >= 0 (no short selling) and sum(w) <= 1 (no leverage)
% using the covariance matrix of monthly returns since ChatGPT. Works in MATLAB (quadprog) and Octave (qp).
%
% Run from the project folder:   octave --no-gui quant/octave/hedge.m
% Reads quant/out/hedge_returns.csv, hedge_career.csv, hedge_eligible.csv, hedge_tickers.txt, hedge_jobs.txt
% Writes quant/out/hedges.csv

1;
is_octave = exist('OCTAVE_VERSION', 'builtin') > 0;
dir = 'quant/out';
if is_octave
  args = argv();
  if numel(args) > 0, dir = args{1}; end
end

R = dlmread(fullfile(dir, 'hedge_returns.csv'));    % months x stocks
H = dlmread(fullfile(dir, 'hedge_career.csv'));     % months x jobs, career value returns
E = dlmread(fullfile(dir, 'hedge_eligible.csv'));   % jobs x stocks, 1 if the company sells into the job
tickers = strsplit(strtrim(fileread(fullfile(dir, 'hedge_tickers.txt'))), "\n");
jobs = strsplit(strtrim(fileread(fullfile(dir, 'hedge_jobs.txt'))), "\n");
[T, K] = size(R);
J = size(H, 2);

tic;
fid = fopen(fullfile(dir, 'hedges.csv'), 'w');
fprintf(fid, 'soc,hedge_dollars_per_dollar,variance_cut,beta_to_basket,top1,w1,top2,w2,top3,w3\n');
cuts = zeros(J, 1);
for j = 1:J
  idx = find(E(j, :) > 0);
  h = H(:, j);
  if isempty(idx) || var(h) < 1e-14
    fprintf(fid, '%s,0,0,0,,,,,,\n', jobs{j});
    continue;
  end
  X = R(:, idx);
  C = cov([h X]);                % joint covariance of career and stock returns
  Sxx = C(2:end, 2:end);
  sxh = C(2:end, 1);
  n = numel(idx);
  Q = 2 * (Sxx + 1e-10 * eye(n));
  q = 2 * sxh;
  if is_octave
    w = qp(zeros(n, 1), Q, q, [], [], zeros(n, 1), ones(n, 1), 0, ones(1, n), 1);
  else
    w = quadprog(Q, q, ones(1, n), 1, [], [], zeros(n, 1), ones(n, 1), [], optimoptions('quadprog', 'Display', 'off'));
  end
  hedged = h + X * w;
  cuts(j) = 1 - var(hedged) / var(h);
  basket = mean(X, 2);
  b = [ones(T, 1) basket] \ h;   % least-squares beta of the career to an equal-weight basket
  [ws, order] = sort(w, 'descend');
  names = {'', '', ''}; vals = [0 0 0];
  for k = 1:min(3, n)
    if ws(k) > 1e-4, names{k} = tickers{idx(order(k))}; vals(k) = ws(k); end
  end
  fprintf(fid, '%s,%.4f,%.4f,%.4f,%s,%.4f,%s,%.4f,%s,%.4f\n', jobs{j}, sum(w), cuts(j), b(2), names{1}, vals(1), names{2}, vals(2), names{3}, vals(3));
end
fclose(fid);
el = toc;
printf('Octave: solved %d constrained hedge problems (%d months x %d stocks) in %.2f s\n', J, T, K, el);
printf('Median variance cut %.0f%%, jobs with a cut above 50%%: %d\n', 100 * median(cuts), sum(cuts > 0.5));
printf('Saved quant/out/hedges.csv\n');
