# Legal docs stubs (legacy /docs/*.md URLs)

If nginx redirects are not configured, these files are served as plain text with a link to the HTML page.

Canonical HTML pages: `privacy-policy.html`, `cookies.html`, `eula.html`, `dpa.html`, `payment-terms.html`, `delete-account.html`.

Do not add Apache `.htaccess` here — production uses nginx. See `deploy/cloudpanel/www-legal-redirects.snippet`.
