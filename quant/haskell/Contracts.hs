-- Implied Automation, step 7: pricing career insurance with a contract language in Haskell.
--
-- Contracts are built from a few small pieces and combined like Lego, in the style of
-- Peyton Jones, Eber and Seward, "Composing contracts: an adventure in financial engineering" (2000).
-- The twist: the risk being priced is not a company defaulting but a job being automated,
-- using the hazard curves the Julia step calibrated to what the stock market is pricing in.
--
-- Build and run from the project folder:
--   ghc -O2 quant/haskell/Contracts.hs -o quant/haskell/contracts && ./quant/haskell/contracts
-- Reads quant/out/hazards.csv, writes quant/out/contracts.csv

module Main where

import Data.List (foldl', sortBy)
import Data.Ord (comparing)
import System.Environment (getArgs)
import Text.Printf (printf, hPrintf)
import System.IO

-- ---------- The contract language ----------

data Contract
  = Zero                          -- worth nothing
  | Pay Double                    -- pay this amount now (in years of pay)
  | Scale Double Contract         -- multiply every payment
  | Both Contract Contract        -- hold both
  | Give Contract                 -- take the other side
  | At Double Contract            -- the contract starts this many years from now
  | IfEmployed Contract           -- only if the job still exists at that moment
  | OnAutomation Double Contract  -- if the job is automated within this many years, start the contract then

-- Small helpers built only from the pieces above
annuity :: Int -> Double -> Contract
annuity years amount = foldl' Both Zero [At (fromIntegral k) (Pay amount) | k <- [0 .. years - 1]]

premiumLeg :: Int -> Contract          -- pay 1 at the end of each year while still employed
premiumLeg years = foldl' Both Zero [At (fromIntegral k) (IfEmployed (Pay 1)) | k <- [1 .. years]]

-- ---------- The model ----------

data State = Employed | Automated deriving Eq

data Model = Model
  { rate   :: Double              -- discount rate
  , knots  :: [Double]            -- hazard curve end points in years, e.g. [1,3,5,10]
  , lambda :: [Double]            -- automation hazard in each piece (flat after the last)
  }

hazardAt :: Model -> Double -> Double
hazardAt m t = go (knots m) (lambda m)
  where
    go (k : ks) (l : ls) = if t < k then l else go ks ls
    go _ ls = if null ls then 0 else last ls

-- Probability the job survives from a to b: exp of minus the integrated hazard
survival :: Model -> Double -> Double -> Double
survival m a b = exp (negate (integrate (hazardAt m) a b))

integrate :: (Double -> Double) -> Double -> Double -> Double
integrate f a b
  | b <= a = 0
  | otherwise = h * (sum (map f inner) + (f a + f b) / 2)
  where
    n = max 1 (ceiling ((b - a) * 52)) :: Int
    h = (b - a) / fromIntegral n
    inner = [a + h * fromIntegral i | i <- [1 .. n - 1]]

-- Value at time t, in state s. Pure and compositional: the value of a combination is built from its parts.
value :: Model -> Double -> State -> Contract -> Double
value m t s c = case c of
  Zero -> 0
  Pay x -> x
  Scale k c' -> k * value m t s c'
  Both a b -> value m t s a + value m t s b
  Give c' -> negate (value m t s c')
  At dt c' ->
    let df = exp (negate (rate m) * dt)
        later st = value m (t + dt) st c'
    in case s of
         Automated -> df * later Automated
         Employed ->
           let p = survival m t (t + dt)
           in df * (p * later Employed + (1 - p) * later Automated)
  IfEmployed c' -> if s == Employed then value m t s c' else 0
  OnAutomation horizon c' -> case s of
    Automated -> 0
    Employed ->
      -- density of being automated at u, discounted, times the contract's value from that moment
      integrate (\u -> hazardAt m u * survival m t u * exp (negate (rate m) * (u - t)) * value m u Automated c') t (t + horizon)

price :: Model -> Contract -> Double
price m = value m 0 Employed

-- ---------- Products ----------

-- Career default swap: pays one year's salary if the job is automated within 5 years.
-- The fair premium is the yearly payment (share of salary) that makes both sides worth the same.
protection5, incomeFloor10 :: Contract
protection5 = OnAutomation 5 (Pay 1)
-- Income floor: if automated within 10 years, pays half your old salary for the next 3 years
incomeFloor10 = OnAutomation 10 (annuity 3 0.5)

-- ---------- CSV in and out ----------

splitOn :: Char -> String -> [String]
splitOn d s = case break (== d) s of
  (a, []) -> [a]
  (a, _ : rest) -> a : splitOn d rest

main :: IO ()
main = do
  args <- getArgs
  let dir = case args of (x : _) -> x; [] -> "quant/out"
  txt <- readFile (dir ++ "/hazards.csv")
  let (header : rows) = filter (not . null) (lines txt)
      cols = splitOn ',' header
      col name r = r !! head [i | (i, c) <- zip [0 ..] cols, c == name]
      ks = [1, 3, 5, 10]
      jobs = [ (col "soc" f, read (col "wage" f) :: Double, map (\n -> read (col n f) :: Double) ["h_0_1", "h_1_3", "h_3_5", "h_5_10"])
             | r <- rows, let f = splitOn ',' r ]
      priced =
        [ (soc, wage, s5, spread, prot, floorPv)
        | (soc, wage, ls) <- jobs
        , let m = Model { rate = 0.04, knots = ks, lambda = ls }
              prot = price m protection5
              spread = prot / price m (premiumLeg 5)
              floorPv = price m incomeFloor10
              s5 = survival m 0 5 ]
  out <- openFile (dir ++ "/contracts.csv") WriteMode
  hPutStrLn out "soc,survival_5y,cds_spread_pct,cds_premium_dollars,protection_pv_dollars,income_floor_pv_dollars"
  mapM_ (\(soc, wage, s5, spread, prot, fl) ->
           hPrintf out "%s,%.5f,%.4f,%.0f,%.0f,%.0f\n" soc s5 (spread * 100) (spread * wage) (prot * wage) (fl * wage)) priced
  hClose out
  printf "Haskell: priced %d career default swaps and %d income floors from the contract language\n" (length priced) (length priced)
  let top = take 5 (sortBy (comparing (\(_, _, _, s, _, _) -> negate s)) priced)
  mapM_ (\(soc, _, s5, spread, _, _) -> printf "  %s  5-year survival %.1f%%  insurance costs %.2f%% of pay a year\n" soc (s5 * 100) (spread * 100)) top
  putStrLn "Saved quant/out/contracts.csv"
