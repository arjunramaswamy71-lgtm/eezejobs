-- Yearly pay in each job, and whether the job is in the top quarter for AI exposure
CREATE OR REPLACE VIEW wages_at_risk AS
SELECT
    soc,
    title,
    exposure_score,
    employment,
    mean_wage,
    employment * mean_wage / 1e9 AS total_pay_billions,
    exposure_score >= 75 AS high_exposure
FROM jobs
WHERE employment IS NOT NULL;

-- Exposure by major job group, for example 13 = Business and Financial
CREATE OR REPLACE VIEW exposure_by_group AS
SELECT
    LEFT(soc, 2) AS major_group,
    COUNT(*) AS jobs,
    SUM(employment) AS workers,
    ROUND(SUM(exposure_score * employment) / SUM(employment), 1) AS weighted_exposure
FROM jobs
WHERE employment IS NOT NULL
GROUP BY 1;

-- Jobs where the AI sources disagree the most
CREATE OR REPLACE VIEW most_disputed_jobs AS
SELECT soc, title, exposure_score, disagreement, sources_used
FROM jobs
WHERE sources_used >= 4
ORDER BY disagreement DESC;
