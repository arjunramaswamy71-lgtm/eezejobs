-- Monthly hiring for each sector, for charts
CREATE OR REPLACE VIEW hiring_monthly AS
SELECT sector, DATE_TRUNC('month', date) AS month, AVG(postings_index) AS postings_index
FROM hiring
GROUP BY 1, 2;
