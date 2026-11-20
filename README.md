# AssetFlow — Asset Movement Management System

A dark-themed, multi-company-ready web application starter implementing the uploaded **Asset Movement System** workflow: request → approval → Stores / IT collection → Security exit → Security return entry → Stores / IT inspection → reconciliation → close.

## Included

- Role-based login and API authorization for Super Admin, Company Admin, Manager, Employee, Stores / IT, Security and Auditor.
- Asset register with unique asset tags / barcode values.
- Movement requests with purpose, destination, expected return date and multiple assets.
- Manager approval, rejection and return-for-changes decisions with reasons.
- Stores / IT handover confirmation and item-level issue condition.
- Security gate exit and return-entry scans, movement-pass matching and duplicate / unapproved scan blocking.
- Full and partial returns; only assets physically scanned at return entry can be received.
- Receipt inspection, condition recording, discrepancy cases and resolution.
- Movement close guard: no outstanding items and no open discrepancy cases.
- Audit log, dashboard, overdue view and summary reports.
- SQLite persistence and demo seed data.

## Requirements

- Node.js 20 or newer
- npm

## Run locally

```bash
npm install
cp .env.example .env
# Set a strong JWT_SECRET in .env before any shared or production use.
npm start
```

Open http://localhost:3000.

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Super Administrator | admin@demo.local | Admin@123 |
| Manager | manager@demo.local | Manager@123 |
| Employee | employee@demo.local | Employee@123 |
| Stores / IT | stores@demo.local | Stores@123 |
| Security | security@demo.local | Security@123 |
| Auditor | auditor@demo.local | Auditor@123 |

Change demo passwords and configure a strong JWT secret before deployment. The first run creates `data/asset-movement.db` and seeds the demo company, branch, users and sample assets.

## Workflow mapping to the specification

| PDF stage | Application implementation |
|---|---|
| 01–06 Request, approval, approved scope, notifications, pass | Request form, manager decision, movement reference |
| 07–09 Stores / IT collection and handover | Collection confirmation and issue condition |
| 10–12 Security exit | Gate console validates movement pass and issued asset tags |
| 13–14 Track outside and return | Movement status and expected return date |
| 15–17 Security return entry | Gate console records only actual returning asset tags |
| 18–22 Stores / IT receipt and inspection | Receipt action, item condition and discrepancy capture |
| 23–24 Reconcile and close | Close endpoint blocks while items or cases remain outstanding |
| Controls at every scan | Operator, timestamp, location, scan type, result and audit event |

## Important implementation notes / next production steps

This is a runnable full-stack starter, not a certified production deployment. Before production use, complete a security review and add: managed user provisioning and password reset, company/branch administration UI, approval routing configuration, email/SMS notification provider, scheduled overdue escalation jobs, scanner/hardware acceptance testing, backups and restore drills, HTTPS/reverse proxy, rate limiting, CSRF strategy if cookie sessions are adopted, retention policy, and formal outage reconciliation procedures.

The PDF identifies some exception policies as requiring management agreement. Those policies are intentionally not assumed here: substitute assets, partial-release policy, expiry of uncollected requests, extension approval, and system-outage contingency should be configured after management confirms them.

## Barcode readers

Most USB and Bluetooth HID scanners behave like keyboards and can type directly into the gate input fields. For production, test the selected scanner model and configure a suffix (Enter) if desired. This starter accepts manually entered barcodes as the same validation path, consistent with the workflow specification.
