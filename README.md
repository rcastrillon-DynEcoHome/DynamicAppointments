# Dynamic Eco Home Appointments

## Production-Grade Offline Audio Recording & Salesforce Integration Platform

---

## Overview

**Dynamic Eco Home Appointments** is a production-ready, offline-first audio recording platform designed to support Salesforce Field Service workflows. The application enables technicians to securely record, manage, and sync consultation audio tied to Salesforce appointments, even when offline or when a mobile device is locked.

The system is built as a **React Progressive Web App (PWA)** with a **Capacitor native wrapper**, backed by **AWS serverless infrastructure**, and integrated with **Salesforce** for appointment status updates and downstream transcript workflows.

---

## Core Capabilities

* High-quality audio recording (web + native)
* Recording continues when the mobile device is locked (Android foreground service)
* Pause, resume, stop, scrap, and preview recordings
* Attach recordings to Salesforce appointment IDs
* Upload existing audio files instead of recording
* Fully offline-capable (IndexedDB + service worker)
* Automatic background sync when connectivity returns
* Unified view of local and cloud recordings
* Secure authentication via AWS Cognito (Salesforce IdP supported)
* Cross-device recording visibility via DynamoDB

---

## High-Level Architecture

**Frontend**

* React 19 + Vite (Rolldown)
* Progressive Web App (installable)
* Capacitor native wrapper (Android / iOS)

**Backend**

* AWS API Gateway
* AWS Lambda
* Amazon S3 (audio storage)
* Amazon DynamoDB (recording index)
* AWS Cognito (Hosted UI authentication)

**Salesforce**

* Deep-link launch from Field Service
* Offline-safe appointment status updates
* Ready for transcript ingestion and QA workflows

---

## Authentication Flow

* Users authenticate via **AWS Cognito Hosted UI**
* Supports:

  * Salesforce Identity Provider
  * Standard Cognito login
* JWT ID token is:

  * Extracted from URL hash
  * Decoded client-side
  * Stored in localStorage
* Token is passed to API Gateway via `Authorization: Bearer <token>`

Key user attributes:

* `sub`
* `email`
* `name`

---

## Appointment Context

The app is launched via a Salesforce deep link:

```
https://<cloudfront-url>/?appointmentId=WO-12345
```

* `appointmentId` is read on load
* Displayed in the UI
* Editable in-app
* Used as:

  * S3 folder key
  * DynamoDB attribute
  * Salesforce status update reference

---

## Audio Recording

### Web Recording

* Uses the browser **MediaRecorder API**
* Auto-selects best supported format:

  * `audio/mp4`
  * `audio/webm`
  * `audio/aac`
* Supports pause/resume and preview before save

### Native Recording (Capacitor)

* Uses `@capgo/capacitor-audio-recorder`
* Android foreground service enabled

  * Recording continues when screen locks
* Native files converted to Blobs for unified upload logic

---

## Offline-First Strategy

### IndexedDB – Recordings

**Database:** `fs-voice-recorder`

Stored per recording:

* `id`
* `appointmentId`
* `createdAt`
* `status` (`pending | uploading | uploaded | failed`)
* `blob`
* `durationSeconds`
* `s3Key`
* `user` metadata

### IndexedDB – Salesforce Events

**Database:** `fs-sf-events`

* Stores appointment status updates while offline
* Events are synced in batches when online
* Ensures no Salesforce updates are lost

---

## Recording Lifecycle

1. Recording saved locally first
2. Status = `pending`
3. When online:

   * App requests presigned S3 upload URL
   * Uploads audio directly to S3
4. S3 trigger indexes metadata into DynamoDB
5. Recording becomes visible across devices
6. Optional local cleanup removes uploaded files

---

## Unified Recordings View

The app merges:

* Local IndexedDB recordings
* Cloud DynamoDB recordings

Into a single list with:

* Date filters
* Status filters
* Device filters
* Upload controls
* Transcript status badges

Duplicate suppression ensures uploaded local items do not appear twice.

---

## Salesforce Integration

### Appointment Status Updates

The app queues Salesforce events when:

* Recording starts → `Arrived / In Progress`
* Recording is saved → `Completed`

Features:

* Works offline
* Batched sync via API Gateway
* Events marked completed only on success

---

## AWS API Endpoints

| Method | Endpoint          | Purpose                        |
| ------ | ----------------- | ------------------------------ |
| POST   | `/getUploadUrl`   | Generate S3 presigned PUT URL  |
| POST   | `/getPlaybackUrl` | Generate S3 presigned GET URL  |
| GET    | `/recordings`     | List user recordings           |
| POST   | `/sfStatusEvents` | Sync Salesforce status updates |

All endpoints use Cognito JWT authorization.

---

## Project Structure

```
src/
├── components/
│   ├── Header.jsx
│   ├── SettingsMenu.jsx
│   ├── TabBar.jsx
│   ├── RecordingStatusBanner.jsx
│   ├── NewRecordingPanel.jsx
│   ├── RecordingsList.jsx
│   └── AudioPlayer.jsx
│
├── hooks/
│   ├── useAuth.js
│   ├── useRecorder.js
│   ├── useRecordings.js
│   └── useSfStatusQueue.js
│
├── lib/
│   ├── apiClient.js
│   ├── db.js
│   ├── device.js
│   └── sfEventsDb.js
│
├── recorderService.js
├── App.jsx
├── main.jsx
├── styles.css
├── index.css
└── index.html
```

---

## PWA & Native Support

* Service worker caches app shell
* Offline playback and recording supported
* Installable on mobile devices
* Capacitor config supports Android and iOS builds

---

## Tooling

* React 19
* Vite (Rolldown)
* Capacitor 8
* IndexedDB
* AWS SDK (via fetch + presigned URLs)
* ESLint

---

## Current State

This project currently provides:

* A robust offline-first recording platform
* Native mobile support with locked-screen recording
* Secure cloud storage and indexing
* Salesforce-aware appointment workflows

---

## Future Enhancements

Planned or supported extensions:

* Automatic AWS Transcribe job creation
* Transcript ingestion into Salesforce
* QA scoring and summarization (Amazon Bedrock)
* Admin dashboards
* Waveform visualization
* Role-based access controls
* Expiring deep links

---

## Status

**Production-ready foundation complete** ✅

The system is stable, scalable, and designed for incremental feature expansion without architectural rework.
