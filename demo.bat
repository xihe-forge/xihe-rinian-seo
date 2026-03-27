@echo off
echo $ npx xihe-rinian-seo audit https://example.com
timeout /t 1 /nobreak >/dev/null
echo.
echo   xihe-rinian-seo v0.3 — SEO + AEO Audit Toolkit
echo   ================================================
echo.
timeout /t 1 /nobreak >/dev/null
echo   [1/7] Technical SEO .............. OK 85/100
echo   [2/7] Content Quality ............ OK 78/100
echo   [3/7] Structured Data ............ WARN 62/100
echo   [4/7] AI Crawlability ............ FAIL 41/100
echo   [5/7] Citation Potential .......... WARN 55/100
echo   [6/7] Competitor Gap Analysis ..... OK 72/100
echo   [7/7] International SEO .......... OK 88/100
echo.
echo   Overall Score: 69/100
echo   SEO: 82/100  AEO: 53/100
echo.
echo   ! AI crawlers blocked by robots.txt
echo   ! Missing FAQ structured data
echo   ! No AI-specific meta tags
echo.
echo   Full report: ./audit-report-example.com.html
