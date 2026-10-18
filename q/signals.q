/ eezejobs trend signals and backtest, written in q for kdb+.
/ Same rules as src/signals.py and the Java engine:
/   1. price above its 200 day average
/   2. 50 day average above the 200 day average
/   3. up over the past 12 months, skipping the latest month
/   4. beat the market over the last 3 months
/ Input: a table `prices` with columns date, sym, close. Missing prices are nulls.

HORIZON:63

/ n day moving average, null until there are n prices in a row with no gaps
mavgFull:{[n;x] ?[n=n msum not null x; n mavg x; 0n]}

/ add every indicator, computed separately for each stock
indicators:{[t]
  t:`sym`date xasc t;
  update ma50:mavgFull[50;close],
         ma200:mavgFull[200;close],
         mom:-1+(21 xprev close)%252 xprev close,
         r3:-1+close%63 xprev close,
         fwd:-1+((neg HORIZON) xprev close)%close
    by sym from t}

/ score 0 to 4 for each stock and day, plus how it did over the next 3 months versus the market
scored:{[t;mkt]
  t:indicators t;
  m:select date, mr3:r3, mfwd:fwd from t where sym=mkt;
  t:t lj `date xkey m;
  t:update valid:(not null ma200) and not null mom,
           c1:close>ma200, c2:ma50>ma200, c3:mom>0, c4:(r3-mr3)>0,
           excess:fwd-mfwd from t;
  update score:(`long$c1)+(`long$c2)+(`long$c3)+`long$c4 from t}

label:{$[x=4;`$"Strong uptrend";x=3;`Uptrend;x=2;`Mixed;`Downtrend]}

/ last trading day of each month from start, leaving 3 months of data after it
monthEnds:{[t;start]
  d:asc distinct exec date from t;
  e:value exec last date by `month$date from ([] date:d);
  e where (e>=start) and e<=d[count[d]-HORIZON+1]}

backtest:{[t;mkt;start]
  s:scored[t;mkt];
  me:monthEnds[t;start];
  r:select from s where date in me, sym<>mkt, valid, not null excess;
  r:update lab:label each score from r;
  res:select times:count i,
             beat_market_pct:100*avg excess>0,
             avg_3m_return_pct:100*avg fwd,
             avg_vs_market_pct:100*avg excess
      by label:lab from r;
  `label xcols 0!res}

/ today's signal for every stock
current:{[t;mkt]
  s:scored[t;mkt];
  last1:select by sym from s where sym<>mkt;
  select sym, date, score, signal:label each score from last1 where valid}
