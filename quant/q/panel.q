/ Implied Automation, step 1: the point-in-time panel, built in q.
/ Inputs set by quant/run_q.py:
/   px:   ([] date; sym; close)                       daily split-adjusted closes
/   fund: ([] sym; item; tag; fyend; filed; val)       SEC 10-K facts with the date each was filed
/   shr:  ([] sym; adate; shares)                       diluted share count from 10-K and 10-Q filings (all share classes)
/ Output: one row per company per month-end, using only facts that were public on that day.

/ Preferred XBRL tag for each item: lower number wins when a company reports more than one
tagRank:(`Revenues`RevenueFromContractWithCustomerExcludingAssessedTax`SalesRevenueNet`RevenueFromContractWithCustomerIncludingAssessedTax,
  `NetCashProvidedByUsedInOperatingActivities`PaymentsToAcquirePropertyPlantAndEquipment`PaymentsToAcquireProductiveAssets,
  `OperatingIncomeLoss`CashAndCashEquivalentsAtCarryingValue`LongTermDebt`LongTermDebtNoncurrent)!til 11

/ The first time each fiscal-year number became public, from the best tag
firstFiled:{[f]
  f:update r:tagRank tag from f;
  f:select from f where r=(min;r) fby ([]sym;item;fyend);
  f:select from f where filed=(min;filed) fby ([]sym;item;fyend);
  / a 10-K can also list a 3-month figure on the same date; the full-year figure is the bigger one
  f:select from f where (abs val)=(max;abs val) fby ([]sym;item;fyend);
  f:0!select first val, first filed by sym, item, fyend from f;
  / keep only fiscal year-ends: each company's usual year-end month, give or take one (52/53-week years)
  ye:select m:first mm by sym from `n xdesc select n:count i by sym, mm:`mm$fyend from f where item=`revenue;
  select sym, item, fyend, val, filed from (f lj ye) where (abs (`mm$fyend)-m) in 0 1 11}

/ One row per company and fiscal year, usable from the day its revenue and cash flow were both filed
annual:{[f]
  w:firstFiled f;
  col:{[w;it;c] (`sym`fyend,c) xcol select sym, fyend, val from w where item=it};
  t:`sym`fyend xkey col[w;`revenue;`revenue];
  t:t lj `sym`fyend xkey col[w;`op_cash;`opcash];
  t:t lj `sym`fyend xkey col[w;`capex;`capex];
  t:t lj `sym`fyend xkey col[w;`cash;`cash];
  t:t lj `sym`fyend xkey col[w;`debt;`debt];
  t:t lj `sym`fyend xkey col[w;`op_income;`opinc];
  kn:select known:max filed by sym, fyend from w where item in `revenue`op_cash;
  `sym`known xasc select from (0!t) lj kn where not null revenue, not null known}

/ Rolling beta against the market from daily returns, vectorised with moving averages
betaRoll:{[p;mkt;n]
  p:update r:-1+close%prev close by sym from `sym`date xasc p;
  m:select date, rm:r from p where sym=mkt;
  p:(select from p where sym<>mkt) lj `date xkey m;
  p:update xy:r*rm, xx:rm*rm from p;
  update beta:(mavg[n;xy]-mavg[n;r]*mavg[n;rm])%(mavg[n;xx]-(mavg[n;rm]) xexp 2) by sym from p}

build:{[px;fund;shr;mkt;start]
  a:annual fund;
  b:betaRoll[px;mkt;252];
  / Month-end grid: last trading day of each month for each company
  g:select sym, date from 0!select last date by sym, m:`month$date from b where date>=start;
  / As-of joins: the price and beta on that day, and the latest fiscal year already filed by that day
  g:aj[`sym`date; g; select sym, date, close, beta from b];
  g:aj[`sym`date; g; `sym`date xasc select sym, date:known, fyend, revenue, opcash, capex, cash, debt, opinc from a];
  / Market value: latest share count times the split-adjusted price (buybacks of a few % a year are ignored)
  s:select shares:last shares by sym from `sym`adate xasc shr;
  g:g lj s;
  g:update mcap:shares*close from g;
  / Steady-state margin: operating profit after a 21% tax, which today's heavy AI capex doesn't distort
  g:update ev:mcap+(0^debt)-0^cash, fcf_margin:(opcash-0^capex)%revenue, nopat_margin:0.79*opinc%revenue from g;
  select sym, date, close, mcap, ev, revenue, fcf_margin, nopat_margin, beta, fyend from g where not null revenue, not null mcap, not null beta}
