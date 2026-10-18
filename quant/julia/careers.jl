# Implied Automation, step 6: from the market's bet to each worker's career, in Julia.
#
#  1. Bootstrap a hazard curve for every job from its market-implied automation curve,
#     the same way credit desks bootstrap default intensities from CDS quotes.
#  2. Monte Carlo 20,000 careers per job: pay that drifts and wobbles each year, and a chance of the
#     job being automated (a pay gap, then a permanent pay cut, as studies of displaced workers find).
#     Uses common random numbers and antithetic draws so the AI / no-AI comparison is precise.
#  3. Value each job's human capital every month since ChatGPT, for the hedge step.
#
# Only Julia's standard library is used. Run from the project folder (in PowerShell):
#   julia -t auto quant/julia/careers.jl
# Reads quant/out/automation_latest.csv, quant/out/automation_monthly.csv
# Writes quant/out/hazards.csv, quant/out/careers.csv, quant/out/hc_monthly.csv

using Random, Statistics, Printf

const DIR = length(ARGS) > 0 ? ARGS[1] : "quant/out"
const KNOTS = [1.0, 3.0, 5.0, 10.0]
const YEARS = 30          # career length valued
const RATE = 0.04         # discount rate for pay
const DRIFT = 0.01        # real pay growth a year
const VOL = 0.06          # yearly pay wobble
const GAP = 0.5           # years without pay after being automated
const CUT = 0.20          # permanent pay cut in the next job
const PATHS = 20_000

# ---------- small CSV helpers (no packages needed) ----------
function readcsv(path)
    lines = filter(!isempty, readlines(path))
    header = split(lines[1], ',')
    rows = [split(l, ',') for l in lines[2:end]]
    Dict(String(h) => [String(r[i]) for r in rows] for (i, h) in enumerate(header))
end
num(v) = parse.(Float64, v)

# ---------- 1. Hazard bootstrapping ----------
# Cumulative automation share F(h) at each knot -> piecewise-flat hazard, never negative
function bootstrap(F::Vector{Float64})
    S = clamp.(1 .- F, 1e-9, 1.0)
    S = accumulate(min, S)                     # survival can only fall
    λ = similar(S)
    prevS, prevT = 1.0, 0.0
    for k in eachindex(KNOTS)
        λ[k] = max(0.0, -log(S[k] / prevS) / (KNOTS[k] - prevT))
        prevS, prevT = S[k], KNOTS[k]
    end
    λ
end

hazard(λ, t) = (k = findfirst(>(t), KNOTS); k === nothing ? λ[end] : λ[k])

# Integrated hazard from 0 to t, piecewise exact
function cumhaz(λ, t)
    total, prev = 0.0, 0.0
    for k in eachindex(KNOTS)
        stop = min(t, KNOTS[k])
        stop > prev && (total += λ[k] * (stop - prev))
        prev = KNOTS[k]
        t <= prev && return total
    end
    total + λ[end] * (t - prev)
end

# Sample the automation time exactly by inverting the cumulative hazard (Inf if never)
function automation_time(λ, e)
    total, prev = 0.0, 0.0
    for k in eachindex(KNOTS)
        piece = λ[k] * (KNOTS[k] - prev)
        if total + piece >= e
            return prev + (e - total) / λ[k]
        end
        total += piece
        prev = KNOTS[k]
    end
    λ[end] > 0 ? prev + (e - total) / λ[end] : Inf
end

# ---------- 2. Monte Carlo careers ----------
function simulate(wage, λ, rng)
    pv_ai = Vector{Float64}(undef, PATHS)
    pv_none = Vector{Float64}(undef, PATHS)
    hit10 = 0
    z = Vector{Float64}(undef, YEARS)
    for p in 1:2:PATHS                       # antithetic pairs share one draw
        randn!(rng, z)
        e = randexp(rng)
        τ = automation_time(λ, e)
        τ <= 10 && (hit10 += 2)
        for (slot, sgn) in ((p, 1.0), (p + 1, -1.0))
            slot > PATHS && break
            w, a, n = wage, 0.0, 0.0
            for y in 1:YEARS
                w *= exp(DRIFT - VOL^2 / 2 + VOL * sgn * z[y])
                df = exp(-RATE * y)
                n += w * df
                # share of this year worked in the old job, in the gap, and in the new lower-paid job
                if τ >= y
                    a += w * df
                else
                    lost = clamp(min(y, τ + GAP) - max(y - 1, τ), 0.0, 1.0)
                    before = clamp(τ - (y - 1), 0.0, 1.0)
                    after = 1.0 - lost - before
                    a += w * df * (before + after * (1 - CUT))
                end
            end
            pv_ai[slot], pv_none[slot] = a, n
        end
    end
    pv_ai, pv_none, hit10 / PATHS
end

# Expected human capital without simulation (used for the monthly series)
function expected_hc(wage, λ)
    total = 0.0
    for y in 1:YEARS
        s = exp(-cumhaz(λ, y))
        total += wage * exp(DRIFT * y) * exp(-RATE * y) * (s + (1 - s) * (1 - CUT))
    end
    total
end

function main()
    t0 = time()
    latest = readcsv(joinpath(DIR, "automation_latest.csv"))
    socs = latest["soc"]
    wages = num(latest["wage"])
    F = hcat(num(latest["a1"]), num(latest["a3"]), num(latest["a5"]), num(latest["a10"]))
    n = length(socs)
    hz = [bootstrap(F[i, :]) for i in 1:n]

    open(joinpath(DIR, "hazards.csv"), "w") do io
        println(io, "soc,wage,h_0_1,h_1_3,h_3_5,h_5_10")
        for i in 1:n
            @printf(io, "%s,%.0f,%.6f,%.6f,%.6f,%.6f\n", socs[i], wages[i], hz[i]...)
        end
    end

    results = Vector{NTuple{7,Float64}}(undef, n)
    Threads.@threads for i in 1:n
        rng = Xoshiro(2026 + i)
        a, b, hit = simulate(wages[i], hz[i], rng)
        diff = b .- a
        se = std(diff) / sqrt(PATHS)
        results[i] = (mean(a), mean(b), 1 - mean(a) / mean(b), quantile(a, 0.05), quantile(a, 0.5), hit, se)
    end
    t1 = time()
    open(joinpath(DIR, "careers.csv"), "w") do io
        println(io, "soc,hc_mean,hc_no_ai,ai_haircut,hc_p5,hc_median,prob_automated_10y,haircut_se_dollars")
        for i in 1:n
            r = results[i]
            @printf(io, "%s,%.0f,%.0f,%.5f,%.0f,%.0f,%.4f,%.0f\n", socs[i], r...)
        end
    end

    monthly = readcsv(joinpath(DIR, "automation_monthly.csv"))
    wage_of = Dict(zip(socs, wages))
    mF = hcat(num(monthly["a1"]), num(monthly["a3"]), num(monthly["a5"]), num(monthly["a10"]))
    open(joinpath(DIR, "hc_monthly.csv"), "w") do io
        println(io, "soc,date,hc")
        for i in eachindex(monthly["soc"])
            s = monthly["soc"][i]
            haskey(wage_of, s) || continue
            @printf(io, "%s,%s,%.0f\n", s, monthly["date"][i], expected_hc(wage_of[s], bootstrap(mF[i, :])))
        end
    end
    t2 = time()

    haircut = [r[3] for r in results]
    order = sortperm(haircut, rev = true)
    @printf("Julia (%d threads): %d jobs x %d careers = %.1f million simulated careers in %.1f s\n",
            Threads.nthreads(), n, PATHS, n * PATHS / 1e6, t1 - t0)
    @printf("Monthly human capital series: %d job-months in %.2f s\n", length(monthly["soc"]), t2 - t1)
    println("Biggest AI haircuts to lifetime pay (market-implied):")
    for i in order[1:min(5, n)]
        @printf("  %-8s %5.1f%%  (chance automated within 10 years %4.1f%%)\n", socs[i], 100 * results[i][3], 100 * results[i][6])
    end
    println("Saved quant/out/hazards.csv, careers.csv and hc_monthly.csv")
end

main()
