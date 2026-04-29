# Sentinel AI Monitor - Low-Level Design (LLD) Document

## Table of Contents
1. [System Architecture Overview](#system-architecture-overview)
2. [Component Architecture](#component-architecture)
3. [Data Models & Schemas](#data-models--schemas)
4. [API Endpoints & Handlers](#api-endpoints--handlers)
5. [Service Layer](#service-layer)
6. [ML Pipeline Architecture](#ml-pipeline-architecture)
7. [Database Design](#database-design)
8. [Real-time Communication (Socket.IO)](#real-time-communication-socketio)
9. [Authentication & Authorization](#authentication--authorization)
10. [Frontend Architecture](#frontend-architecture)
11. [Error Handling & Logging](#error-handling--logging)

---

## 1. System Architecture Overview

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React + TypeScript)            │
│  ├─ Dashboard (Admin/Operator Views)                            │
│  ├─ Monitoring Page (Live Camera Feeds)                         │
│  ├─ Incidents Management                                        │
│  └─ Responder Panel                                             │
└──────────────────────┬──────────────────────────────────────────┘
                       │ HTTP / WebSocket
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Node.js + Express)                   │
│  ├─ API Routes & Controllers                                    │
│  ├─ Socket.IO Handler                                           │
│  ├─ Auth Service (Google OAuth)                                 │
│  ├─ Camera Status Monitor                                       │
│  ├─ Fire Escalation Service                                     │
│  └─ YOLO Worker Manager                                         │
└──────────────────────┬──────────────────────────────────────────┘
         ┌─────────────┼─────────────┐
         │             │             │
         ↓             ↓             ↓
    ┌────────┐    ┌──────────┐  ┌─────────────┐
    │ MongoDB│    │ YOLO API │  │  FastAPI    │
    │ Database│    │ (Python) │  │  (Python)   │
    └────────┘    └──────────┘  └─────────────┘
```

### 1.2 Technology Stack

**Frontend:**
- React 18.3.1 with TypeScript
- Vite (Build tool)
- TailwindCSS (Styling)
- Zustand (State management)
- React Query (Data fetching)
- Socket.IO Client (Real-time communication)
- Leaflet (Map visualization)

**Backend:**
- Node.js with Express.js
- MongoDB (Database)
- Socket.IO (WebSocket communication)
- JWT (Authentication)
- Google OAuth

**ML/AI:**
- Python 3.x
- YOLOv8 (Object detection)
- FastAPI (ML API server)
- OpenCV (Image processing)
- NumPy (Numerical processing)

---

## 2. Component Architecture

### 2.1 Backend Components

#### 2.1.1 API Layer (Express Routes)

```
backend/routes/
├── authRoutes.js          # Authentication endpoints
├── cameraRoutes.js        # Camera management
├── detectionRoutes.js     # Detection/YOLO results
└── incidentRoutes.js      # Incident management
```

**Route Handlers:**

```javascript
// Auth Routes
POST   /api/auth/register          - User registration
POST   /api/auth/google/callback   - Google OAuth callback
GET    /api/auth/me                - Get current user
POST   /api/auth/logout            - User logout

// Camera Routes
GET    /api/cameras                - List all cameras
POST   /api/cameras                - Create new camera
GET    /api/cameras/:id            - Get camera details
PATCH  /api/cameras/:id            - Update camera
DELETE /api/cameras/:id            - Delete camera
GET    /api/cameras/:id/status     - Get camera online status

// Detection Routes
POST   /api/detections/analyze     - Send frame to YOLO for analysis
GET    /api/detections/:cameraId   - Get detections for camera

// Incident Routes
GET    /api/incidents              - List incidents
POST   /api/incidents              - Create incident
GET    /api/incidents/:id          - Get incident details
PATCH  /api/incidents/:id          - Update incident status
POST   /api/incidents/:id/assign   - Assign to responder
POST   /api/incidents/:id/resolve  - Mark as resolved
```

#### 2.1.2 Service Layer

```
backend/services/
├── authService.js              # Authentication & JWT handling
├── cameraService.js            # Camera management logic
├── incidentService.js          # Incident processing
├── yoloService.js              # YOLO API integration
├── cameraStatusMonitor.js      # Monitor camera online/offline
├── fireEscalationService.js    # Fire incident escalation
└── yoloWorkerManager.js        # Manage YOLO worker processes
```

**Service Responsibilities:**

```javascript
// authService
- User registration & login
- JWT token generation/verification
- Google OAuth integration
- User role management

// cameraService
- CRUD operations on cameras
- Camera URL validation
- Camera status tracking
- Frame capture from stream

// incidentService
- Create incidents from detections
- Update incident status
- Assign incidents to responders
- Calculate response times
- Generate incident summaries

// yoloService
- Send frames to YOLO API
- Parse detection results
- Normalize detection format
- Error handling for ML service

// cameraStatusMonitor
- Periodically check camera connectivity
- Track last_active timestamp
- Emit events when camera goes offline
- Update database status

// fireEscalationService
- Monitor fire incidents
- Auto-escalate if no response
- Send notifications
- Trigger emergency protocols

// yoloWorkerManager
- Manage YOLO worker processes
- Handle process pooling
- Load balancing across workers
- Health checks
```

#### 2.1.3 Middleware

```
backend/middlewares/
├── errorHandler.js         # Global error handling
├── authMiddleware.js       # JWT verification
├── roleMiddleware.js       # Role-based access control
└── validationMiddleware.js # Input validation
```

#### 2.1.4 Models (MongoDB Schemas)

```
backend/models/
├── User.js                 # User schema
├── Camera.js               # Camera schema
├── Incident.js             # Incident schema
└── Detection.js            # Detection history schema
```

### 2.2 Frontend Components

#### 2.2.1 Page Structure

```
Frontend/src/pages/
├── Auth.tsx                  # Login/registration
├── Monitoring.tsx            # Live camera monitoring
├── Incidents.tsx             # Incident management
├── Overview.tsx              # Dashboard overview
├── DecisionOversight.tsx      # Decision audit trail
├── ResponderPanel.tsx        # Responder interface
├── AdminUsers.tsx            # User management
├── AuditLogs.tsx             # Audit logging
└── ZoneMap.tsx               # Geographic zones on map
```

#### 2.2.2 Component Hierarchy

```
App
├── DashboardLayout
│   ├── Navigation
│   ├── Sidebar
│   └── Main Content
├── Overview (Dashboard)
│   ├── StatCard
│   ├── IncidentTrend
│   ├── DecisionChart
│   └── RecentIncidents
├── Monitoring
│   ├── CameraGrid
│   │   ├── CameraFeed
│   │   └── DetectionOverlay
│   ├── ControlPanel
│   └── AlertBanner
├── Incidents
│   ├── IncidentTable
│   │   ├── IncidentRow
│   │   └── StatusBadge
│   ├── FilterPanel
│   └── DetailModal
└── ResponderPanel
    ├── AssignedIncidents
    ├── ActionButtons
    └── ValidationForm
```

#### 2.2.3 State Management (Zustand)

```typescript
// Store structure
useIncidentStore
├── incidents: Incident[]
├── selectedIncident: Incident | null
├── loading: boolean
├── error: string | null
└── actions:
    ├── setIncidents()
    ├── addIncident()
    ├── updateIncident()
    └── removeIncident()

useAuthStore
├── user: AuthUser | null
├── isAuthenticated: boolean
├── token: string
├── userRole: UserRole
└── actions:
    ├── login()
    ├── logout()
    └── setUser()

useCameraStore
├── cameras: Camera[]
├── activeCameraId: string
├── selectedCamera: Camera | null
└── actions:
    ├── setCameras()
    ├── setActiveCamera()
    └── updateCameraStatus()
```

#### 2.2.4 API Integration (React Query)

```typescript
// Queries
useQuery('incidents', getIncidents)
useQuery(['incident', id], () => getIncidentById(id))
useQuery('cameras', getCameras)
useQuery('users', getUsers)

// Mutations
useMutation(createIncident)
useMutation(updateIncident)
useMutation(assignIncident)
useMutation(resolveIncident)
```

---

## 3. Data Models & Schemas

### 3.1 User Schema

```javascript
{
  _id: ObjectId,
  googleId: String (unique),           // Google OAuth ID
  email: String (unique),              // Email address
  name: String,                        // User name
  avatar: String,                      // Avatar URL
  role: String,                        // admin | operator | responder
  responderType: String,               // medical | fire | crowd | inactivity
  approvalStatus: String,              // pending | approved | rejected
  createdAt: Date,
  updatedAt: Date
}

// Indexes
email (unique)
googleId (unique)
role
approvalStatus
```

### 3.2 Camera Schema

```javascript
{
  _id: ObjectId,
  name: String (required),             // Camera name
  sourceType: String,                  // RTSP | SYSTEM
  rtspUrl: String (unique),            // RTSP/HTTP URL
  deviceId: String,                    // Device identifier
  deviceIndex: Number,                 // Device index (0-based)
  location: String,                    // Location/zone name
  status: String,                      // ONLINE | OFFLINE
  lastActive: Date,                    // Last activity timestamp
  createdAt: Date,
  updatedAt: Date
}

// Indexes
rtspUrl (unique)
status
location
lastActive
```

### 3.3 Incident Schema (Detailed)

```javascript
{
  _id: ObjectId,
  id: String (unique),                 // Unique incident ID
  type: String,                        // fire | crowd | medical | security | inactivity
  severity: String,                    // low | medium | high | critical
  status: String,                      // active | assigned | in_progress | 
                                        // pending_confirmation | escalated | resolved
  confidence: Number (0-1),            // Model confidence score
  timestamp: Date,                     // Incident detection time
  zone: String,                        // Zone/location name
  location: {
    lat: Number,                       // Latitude
    lng: Number                        // Longitude
  },
  sourceCameraId: ObjectId (ref),      // Reference to Camera
  description: String,                 // Incident description
  assignedTo: String,                  // Assigned user name
  assignedResponderId: ObjectId (ref), // Reference to User (responder)
  assignedAt: Date,                    // Assignment timestamp
  acceptedAt: Date,                    // Responder acceptance time
  resolvedByResponderId: ObjectId (ref),  // Resolver user reference
  responderValidation: String,         // pending | valid_incident | false_alert
  aiDecision: String,                  // needs_human_validation | 
                                        // auto_resolved | auto_escalated
  detectionMethod: String,             // YOLO | POSE | CNN | HYBRID
  predictionDetails: String,           // ML model prediction details
  snapshotUrl: String,                 // URL to incident snapshot
  snapshotBase64: String,              // Base64 encoded snapshot
  notes: [String],                     // Array of notes/comments
  confirmationDeadline: Date,          // Deadline for confirmation
  escalatedAt: Date,                   // Escalation timestamp
  resolvedAt: Date,                    // Resolution timestamp
  createdAt: Date,
  updatedAt: Date
}

// Indexes
timestamp (-1)
status (1), severity (1)
type (1), status (1), timestamp (-1)
assignedResponderId (1), status (1), timestamp (-1)
sourceCameraId (1), type (1), status (1), timestamp (-1)
```

### 3.4 Detection Schema

```javascript
{
  _id: ObjectId,
  cameraId: ObjectId (ref),            // Reference to Camera
  timestamp: Date,                     // Detection timestamp
  detections: [
    {
      class: Number,                   // Class ID
      confidence: Number,              // Confidence score (0-1)
      bbox: {                          // Bounding box
        x1: Number,
        y1: Number,
        x2: Number,
        y2: Number,
        width: Number,
        height: Number,
        center_x: Number,
        center_y: Number,
        area: Number
      }
    }
  ],
  summary: {
    total_objects: Number,
    person_count: Number,
    vehicle_count: Number,
    unique_classes: Number
  },
  scores: {
    person: Number,
    crowd: Number,
    stampede: Number,
    medical_emergency: Number,
    fire: Number,
    smoke: Number,
    running: Number,
    fallen: Number,
    violence: Number,
    weapon: Number,
    crowd_density: Number,
    suspicious_activity: Number
  },
  createdAt: Date
}

// Indexes
cameraId, timestamp (-1)
timestamp (-1)
cameraId (1), timestamp (-1)
```

---

## 4. API Endpoints & Handlers

### 4.1 Authentication Endpoints

```
POST /api/auth/register
  Headers: Content-Type: application/json
  Body: {
    email: string,
    password: string (if not OAuth),
    name: string
  }
  Response: { user, token }
  Status: 201 Created

POST /api/auth/google/callback
  Headers: Content-Type: application/json
  Body: {
    code: string,           // Google auth code
    state: string
  }
  Response: { user, token }
  Status: 200 OK

GET /api/auth/me
  Headers: Authorization: Bearer {token}
  Response: { user }
  Status: 200 OK

POST /api/auth/logout
  Headers: Authorization: Bearer {token}
  Response: { message: "Logged out successfully" }
  Status: 200 OK
```

### 4.2 Camera Management Endpoints

```
GET /api/cameras
  Headers: Authorization: Bearer {token}
  Query: ?status=ONLINE&limit=10&offset=0
  Response: { cameras: [Camera], total: number }
  Status: 200 OK

POST /api/cameras
  Headers: Authorization: Bearer {token}, Content-Type: application/json
  Body: {
    name: string,
    rtspUrl: string,
    location: string,
    sourceType: "RTSP" | "SYSTEM"
  }
  Response: { camera: Camera }
  Status: 201 Created

GET /api/cameras/:id
  Headers: Authorization: Bearer {token}
  Response: { camera: Camera }
  Status: 200 OK

PATCH /api/cameras/:id
  Headers: Authorization: Bearer {token}, Content-Type: application/json
  Body: { name?, rtspUrl?, location? }
  Response: { camera: Camera }
  Status: 200 OK

DELETE /api/cameras/:id
  Headers: Authorization: Bearer {token}
  Response: { message: "Camera deleted" }
  Status: 200 OK

GET /api/cameras/:id/status
  Headers: Authorization: Bearer {token}
  Response: {
    cameraId: string,
    status: "ONLINE" | "OFFLINE",
    lastActive: Date
  }
  Status: 200 OK
```

### 4.3 Detection Endpoints

```
POST /api/detections/analyze
  Headers: Authorization: Bearer {token}, Content-Type: multipart/form-data
  Body:
    file: File (image),
    cameraId: string
  Response: {
    detections: [Detection],
    scores: {fire, smoke, crowd, etc.},
    summary: {total_objects, person_count}
  }
  Status: 200 OK

GET /api/detections/:cameraId
  Headers: Authorization: Bearer {token}
  Query: ?limit=100&offset=0&from=2026-04-01&to=2026-04-30
  Response: { detections: [Detection], total: number }
  Status: 200 OK
```

### 4.4 Incident Management Endpoints

```
GET /api/incidents
  Headers: Authorization: Bearer {token}
  Query: ?type=fire&status=active&severity=critical&limit=50
  Response: { incidents: [Incident], total: number }
  Status: 200 OK

POST /api/incidents
  Headers: Authorization: Bearer {token}, Content-Type: application/json
  Body: {
    type: string,
    severity: string,
    zone: string,
    location: {lat, lng},
    description: string,
    sourceCameraId: string,
    confidence: number
  }
  Response: { incident: Incident }
  Status: 201 Created

GET /api/incidents/:id
  Headers: Authorization: Bearer {token}
  Response: { incident: Incident }
  Status: 200 OK

PATCH /api/incidents/:id
  Headers: Authorization: Bearer {token}, Content-Type: application/json
  Body: {
    status?: string,
    severity?: string,
    responderValidation?: string,
    notes?: [string]
  }
  Response: { incident: Incident }
  Status: 200 OK

POST /api/incidents/:id/assign
  Headers: Authorization: Bearer {token}, Content-Type: application/json
  Body: {
    responderId: string
  }
  Response: { incident: Incident }
  Status: 200 OK

POST /api/incidents/:id/resolve
  Headers: Authorization: Bearer {token}, Content-Type: application/json
  Body: {
    validation: "valid_incident" | "false_alert",
    notes?: string
  }
  Response: { incident: Incident }
  Status: 200 OK

GET /api/incidents/:id/history
  Headers: Authorization: Bearer {token}
  Response: { history: [IncidentUpdate] }
  Status: 200 OK
```

---

## 5. Service Layer

### 5.1 Auth Service

```javascript
class AuthService {
  // Register new user
  async register(email, name) → User
  
  // Google OAuth verification
  async verifyGoogleToken(token) → {id, email, name, picture}
  
  // Generate JWT token
  generateToken(userId, role) → string
  
  // Verify JWT token
  verifyToken(token) → {userId, role}
  
  // Get current user
  async getCurrentUser(userId) → User
  
  // Check user role permission
  hasRole(user, requiredRole) → boolean
}
```

### 5.2 Camera Service

```javascript
class CameraService {
  // Create camera
  async create(cameraData) → Camera
  
  // Get all cameras
  async getAll(query) → Camera[]
  
  // Get camera by ID
  async getById(cameraId) → Camera
  
  // Update camera
  async update(cameraId, updates) → Camera
  
  // Delete camera
  async delete(cameraId) → void
  
  // Check camera status
  async checkStatus(camera) → {status, lastActive}
  
  // Validate RTSP URL
  validateRtspUrl(url) → boolean
  
  // Get camera frame
  async captureFrame(rtspUrl) → Buffer
}
```

### 5.3 Incident Service

```javascript
class IncidentService {
  // Create incident
  async create(incidentData) → Incident
  
  // Get incidents with filters
  async getAll(filters, query) → Incident[]
  
  // Get incident by ID
  async getById(incidentId) → Incident
  
  // Update incident status
  async updateStatus(incidentId, status) → Incident
  
  // Assign incident to responder
  async assign(incidentId, responderId) → Incident
  
  // Resolve incident
  async resolve(incidentId, validation, notes) → Incident
  
  // Calculate response time
  calculateResponseTime(incident) → number (milliseconds)
  
  // Get incident statistics
  async getStats(filters) → {
    total, active, resolved, avgResponseTime
  }
  
  // Check auto-escalation
  async checkEscalation(incident) → boolean
  
  // Add note to incident
  async addNote(incidentId, note) → Incident
}
```

### 5.4 YOLO Service

```javascript
class YoloService {
  // Initialize YOLO connection
  async initialize() → void
  
  // Send frame for analysis
  async analyzeFrame(buffer, cameraId) → {
    detections: [],
    scores: {},
    summary: {}
  }
  
  // Normalize detections
  normalizeDetection(detection) → {
    class, confidence, bbox
  }
  
  // Get YOLO health status
  async getHealth() → {status, model, loaded}
  
  // Check confidence threshold
  isAboveThreshold(confidence, threshold) → boolean
}
```

### 5.5 Camera Status Monitor

```javascript
class CameraStatusMonitor {
  // Start monitoring
  startMonitoring() → void
  
  // Stop monitoring
  stopMonitoring() → void
  
  // Check single camera
  async checkCamera(camera) → {status, lastActive}
  
  // Emit status change event
  emitStatusChange(cameraId, status) → void
  
  // Handle offline camera
  async handleOfflineCamera(camera) → void
}
```

### 5.6 Fire Escalation Service

```javascript
class FireEscalationService {
  // Start escalation monitoring
  startMonitoring() → void
  
  // Check fire incident escalation
  async checkEscalation(incident) → boolean
  
  // Auto-escalate incident
  async escalate(incidentId) → Incident
  
  // Calculate escalation score
  calculateEscalationScore(incident) → number
  
  // Notify on escalation
  async notify(incident, responders) → void
}
```

---

## 6. ML Pipeline Architecture

### 6.1 YOLO FastAPI Server

```python
# backend/pythonmodel/yolo_fastapi_server.py

class YOLOServer:
  def __init__(model_path):
    - Load YOLOv8 model
    - Initialize confidence thresholds
    - Setup FastAPI app
    - Configure Socket.IO
  
  @app.post("/api/ml/analyze/enhanced")
  async def analyze_frame(file, camera_id):
    - Decode image
    - Run YOLO inference
    - Extract bounding boxes
    - Calculate detection scores
    - Apply color-based fire/smoke detection
    - Score detections (crowd density, stampede, etc.)
    - Filter hazard detections
    - Return JSON response
  
  def score_detections(detections, frame_shape):
    - Count persons
    - Calculate crowd density
    - Detect stampede patterns
    - Detect fallen persons
    - Detect weapons
    - Return scores dictionary
  
  def calculate_crowd_density():
    Formula: CrowdDensity = PersonCount × 11.0 + PersonAreaRatio × 250.0
  
  def calculate_stampede_score():
    Formula: StampedeScore = CrowdDensity × 0.9 + (PersonCount - 9) × 4.0
  
  @app.get("/health")
  async def health():
    - Return model status
    - Confidence thresholds
    - Available classes
```

### 6.2 Detection Pipeline

```
Frame Capture
    ↓
[Image Preprocessing]
    ├─ Resize to 640×640
    ├─ Normalize
    └─ Convert to tensor
    ↓
[YOLO Inference]
    ├─ Forward pass through model
    ├─ Get predictions
    └─ Apply NMS (IoU threshold 0.45)
    ↓
[Post-Processing]
    ├─ Extract bounding boxes (XYXY format)
    ├─ Normalize coordinates
    ├─ Calculate areas
    └─ Convert to XYWH format
    ↓
[Color-Based Fallback]
    ├─ Convert to HSV
    ├─ Apply fire/smoke masks
    └─ Extract contours
    ↓
[Scoring & Classification]
    ├─ Calculate confidence scores
    ├─ Apply thresholds
    ├─ Classify as fire/smoke/crowd/etc
    └─ Generate risk scores
    ↓
[Aggregation]
    ├─ Collect all detections
    ├─ Remove overlaps
    └─ Create summary statistics
    ↓
[Response Generation]
    └─ JSON response with detections
```

### 6.3 Model Parameters

```python
# Detection Parameters
YOLO_CONFIDENCE = 0.15           # Confidence threshold
YOLO_IOU = 0.45                  # NMS IoU threshold
YOLO_IMGSZ = 640                 # Input image size

# Fire Detection
YOLO_FIRE_ALERT_THRESHOLD = 0.90
YOLO_FIRE_CLASS_CONFIDENCE_MIN = 0.20
YOLO_FIRE_MIN_BOX_AREA_RATIO = 0.0002
YOLO_FIRE_ALERT_THRESHOLD = 0.90

# Smoke Detection
YOLO_SMOKE_ALERT_THRESHOLD = 0.50
YOLO_SMOKE_CLASS_CONFIDENCE_MIN = 0.30
YOLO_SMOKE_MIN_BOX_AREA_RATIO = 0.0004

# Color Detection (HSV ranges)
FIRE_RANGES = [
  (H: 0-20, S: 120-255, V: 90-255),    # Red-orange
  (H: 160-180, S: 120-255, V: 90-255)  # Red continuation
]
SMOKE_RANGES = [
  (H: 0-180, S: 0-45, V: 70-210)       # Gray shades
]

# Crowd & Stampede
YOLO_STAMPEDE_MIN_PERSON_COUNT = 9
YOLO_STAMPEDE_SCORE_THRESHOLD = 55
YOLO_CROWD_DENSITY_THRESHOLD = 30.0

# Weapon Detection
WEAPON_HINTS = {knife, gun, rifle, pistol, scissors, baseball bat}
```

---

## 7. Database Design

### 7.1 MongoDB Collections

```
sentinel-ai-monitor (database)
├── users
│   ├── Indexes: {email: 1 unique}, {googleId: 1 unique}, {role: 1}
│   └── Size: ~10KB per document
│
├── cameras
│   ├── Indexes: {rtspUrl: 1 unique}, {status: 1}, {location: 1}
│   └── Size: ~1KB per document
│
├── incidents
│   ├── Indexes: {timestamp: -1}, {status: 1, severity: 1}, 
│   │             {type: 1, status: 1, timestamp: -1},
│   │             {assignedResponderId: 1, status: 1, timestamp: -1},
│   │             {sourceCameraId: 1, type: 1, status: 1, timestamp: -1}
│   └── Size: ~5KB per document
│
├── detections
│   ├── Indexes: {cameraId: 1, timestamp: -1}, {timestamp: -1}
│   └── Size: ~50KB per document
│
└── auditlogs
    ├── Indexes: {userId: 1, timestamp: -1}, {action: 1}
    └── Size: ~1KB per document
```

### 7.2 Relationships

```
User (1) ─────── (n) Incident
      └─ assigned to responders

Camera (1) ────── (n) Incident
      └─ detected in

Camera (1) ────── (n) Detection
      └─ contains

Incident (1) ──── (n) AuditLog
      └─ changes logged

User (1) ──────── (n) AuditLog
      └─ performed by
```

### 7.3 Query Patterns

```javascript
// Most frequent queries
db.incidents.find({status: "active", severity: "critical"})
db.incidents.find({sourceCameraId: cameraId, timestamp: {$gte: startDate}})
db.detections.find({cameraId: cameraId}).sort({timestamp: -1}).limit(100)
db.users.find({approvalStatus: "pending"})
db.cameras.find({status: "OFFLINE"})

// Aggregation pipelines
db.incidents.aggregate([
  {$match: {timestamp: {$gte: startDate}}},
  {$group: {_id: "$type", count: {$sum: 1}}},
  {$sort: {count: -1}}
])

// Average response time
db.incidents.aggregate([
  {$match: {resolvedAt: {$exists: true}}},
  {$project: {
    responseTime: {$subtract: ["$resolvedAt", "$timestamp"]}
  }},
  {$group: {
    _id: null,
    avgResponseTime: {$avg: "$responseTime"}
  }}
])
```

---

## 8. Real-time Communication (Socket.IO)

### 8.1 Socket Events

```javascript
// Client → Server
socket.emit('detection:frame', {
  cameraId: string,
  frameBuffer: Buffer
})

socket.emit('incident:assign', {
  incidentId: string,
  responderId: string
})

socket.emit('incident:resolve', {
  incidentId: string,
  validation: string
})

socket.emit('room:join', {
  role: string,
  zone: string,
  cameraId: string
})

// Server → Client
socket.on('detection:update', {
  cameraId: string,
  detections: [Detection],
  timestamp: Date
})

socket.on('fire:alert', {
  cameraId: string,
  confidence: number,
  location: {lat, lng},
  timestamp: Date
})

socket.on('stampede:alert', {
  cameraId: string,
  personCount: number,
  score: number,
  timestamp: Date
})

socket.on('incident:created', {
  incident: Incident
})

socket.on('incident:updated', {
  incident: Incident
})

socket.on('camera:offline', {
  cameraId: string,
  lastActive: Date
})

socket.on('ml:scores', {
  cameraId: string,
  scores: {fire, smoke, crowd, etc.},
  timestamp: Date
})
```

### 8.2 Socket.IO Namespaces

```javascript
// Monitoring namespace (live detections)
io.of('/monitoring').on('connection', (socket) => {
  socket.on('join:camera', (cameraId) => {
    socket.join(`camera_${cameraId}`)
  })
  
  socket.on('leave:camera', (cameraId) => {
    socket.leave(`camera_${cameraId}`)
  })
})

// Admin namespace (user management)
io.of('/admin').on('connection', (socket) => {
  socket.on('user:approve', (userId) => {
    // Emit to all admins
    io.of('/admin').emit('user:approved', {userId})
  })
})

// Responder namespace (incident assignment)
io.of('/responder').on('connection', (socket) => {
  socket.on('incident:accept', (incidentId) => {
    // Update incident status
  })
})
```

---

## 9. Authentication & Authorization

### 9.1 OAuth Flow

```
┌─────────────┐                    ┌──────────────┐
│   Frontend  │                    │ Google OAuth │
└─────────────┘                    └──────────────┘
      │                                    │
      │  1. initiate login                 │
      ├───────────────────────────────────>│
      │                                    │
      │  2. redirect to auth code          │
      │<───────────────────────────────────┤
      │                                    │
      │  3. send code + state              │
      │───────────────┬─────────────────┐  │
      │               │                 │  │
      │               ↓                 ↓  │
      │          ┌─────────────┐           │
      │          │   Backend   │           │
      │          │   /callback │           │
      │          └─────────────┘           │
      │               │                    │
      │               │  4. verify code    │
      │               ├───────────────────>│
      │               │                    │
      │               │  5. return token   │
      │               │<───────────────────┤
      │               │                    │
      │               │  6. create user    │
      │               ├──→ MongoDB         │
      │               │                    │
      │  7. JWT token │                    │
      │<──────────────┤                    │
      │               │                    │
      │ JWT stored    │                    │
      │ in localStorage│                   │
```

### 9.2 JWT Token Structure

```javascript
{
  header: {
    alg: "HS256",
    typ: "JWT"
  },
  payload: {
    userId: ObjectId,
    email: string,
    role: "admin" | "operator" | "responder",
    iat: timestamp,
    exp: timestamp
  },
  signature: HMAC_SHA256(header + payload, secret)
}
```

### 9.3 Role-Based Access Control (RBAC)

```javascript
// Role Definitions
const ROLES = {
  admin: {
    permissions: [
      'manage_users',
      'manage_cameras',
      'view_all_incidents',
      'escalate_incidents',
      'view_audit_logs'
    ]
  },
  operator: {
    permissions: [
      'view_incidents',
      'assign_incidents',
      'view_cameras',
      'monitor_live'
    ]
  },
  responder: {
    permissions: [
      'view_assigned_incidents',
      'update_incident_status',
      'validate_incidents'
    ]
  }
}

// Middleware check
app.use(requireRole('admin'), (req, res) => {
  // Only admins can access
})
```

---

## 10. Frontend Architecture

### 10.1 Routing Structure

```
/ (public)
├─ /auth/login
├─ /auth/callback
│
/dashboard (protected, requires authentication)
├─ / (Overview)
├─ /monitoring (Live monitoring)
├─ /incidents (Incident management)
├─ /decision-oversight (Admin only)
├─ /admin
│   ├─ /users (User management)
│   ├─ /logs (Audit logs)
│   └─ /oversight (Decision override)
├─ /map (Operator/Admin)
├─ /responder (Responder panel)
│
└─ * (404 Not Found)
```

### 10.2 Component Data Flow

```
User Input
    ↓
[Component Handler]
    ↓
[React Query Mutation]
    ↓
[API Call (HTTP/Socket)]
    ↓
[Backend Route Handler]
    ↓
[Service Layer Logic]
    ↓
[Database Operations]
    ↓
[Response]
    ↓
[React Query Update]
    ↓
[Zustand State Update]
    ↓
[Component Re-render]
```

### 10.3 WebSocket Integration

```typescript
// Socket connection management
useEffect(() => {
  const socket = io(BACKEND_URL, {
    auth: { token: authToken }
  })
  
  socket.on('detection:update', (data) => {
    // Update detection store
    updateDetections(data)
  })
  
  socket.on('fire:alert', (data) => {
    // Show alert
    showAlert('Fire detected!', 'critical')
  })
  
  return () => socket.disconnect()
}, [authToken])
```

---

## 11. Error Handling & Logging

### 11.1 Error Hierarchy

```
Error
├─ ValidationError
│  ├─ FieldError
│  └─ RequestError
├─ AuthenticationError
│  ├─ InvalidTokenError
│  └─ ExpiredTokenError
├─ AuthorizationError
│  └─ InsufficientPermissionsError
├─ DatabaseError
│  ├─ ConnectionError
│  └─ QueryError
├─ ServiceError
│  ├─ YoloServiceError
│  ├─ CameraServiceError
│  └─ IncidentServiceError
└─ SystemError
   ├─ ConfigError
   └─ TimeoutError
```

### 11.2 Error Response Format

```javascript
{
  success: false,
  error: string,
  code: string,
  statusCode: number,
  details: {
    field?: string,
    value?: any,
    message?: string
  },
  timestamp: Date,
  path: string
}
```

### 11.3 Logging Strategy

```javascript
// Winston logger levels
LOGGER.error(error, {
  context: 'ServiceName',
  userId: userId,
  incidentId: incidentId
})

LOGGER.warn(message, {
  context: 'ServiceName',
  threshold: thresholdValue
})

LOGGER.info(message, {
  context: 'ServiceName',
  action: 'camera_status_check'
})

// Log locations
logs/
├─ error.log        # All errors
├─ combined.log     # All levels
├─ auth.log         # Auth events
├─ detection.log    # Detection events
└─ incident.log     # Incident events
```

### 11.4 Audit Logging

```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  action: string,              // create_incident, assign_incident, etc.
  resource: string,            // incident, camera, user
  resourceId: ObjectId,
  oldValue: any,
  newValue: any,
  timestamp: Date,
  ipAddress: string,
  userAgent: string
}

// Audit log events
POST /incident → creates audit log
PATCH /incident → creates audit log
DELETE /camera → creates audit log
POST /user/approve → creates audit log
```

---

## 12. Performance Considerations

### 12.1 Optimization Techniques

**Frontend:**
- Code splitting with Vite
- Lazy loading components
- Memoization of expensive computations
- Virtual scrolling for large lists
- Image compression for thumbnails

**Backend:**
- Database indexing on frequently queried fields
- Connection pooling for MongoDB
- Caching of user roles/permissions
- Rate limiting on API endpoints
- Compression of responses (gzip)

**ML:**
- Model quantization for faster inference
- Batch processing of frames
- Async processing with worker threads
- Caching of model predictions

### 12.2 Scaling Strategy

```
Single Server
├─ Frontend: Vite → Nginx
├─ Backend: Node.js cluster
├─ ML: FastAPI + Gunicorn
└─ Database: MongoDB replica set

Multi-Server
├─ Load Balancer (HAProxy/Nginx)
├─ Frontend: CDN (CloudFront/CloudFlare)
├─ Backend: Auto-scaling group
├─ ML: Distributed processing
├─ Database: Sharded MongoDB
└─ Cache: Redis cluster
```

---

## 13. Deployment Architecture

### 13.1 Docker Containers

```dockerfile
# Frontend
FROM node:18-alpine
COPY . /app
RUN npm install && npm run build
EXPOSE 3226

# Backend
FROM node:18-alpine
COPY . /app
RUN npm install
EXPOSE 5000

# ML Server
FROM python:3.10
COPY . /app
RUN pip install -r requirements.txt
EXPOSE 8000
```

### 13.2 Docker Compose

```yaml
version: '3.8'
services:
  frontend:
    build: ./Frontend
    ports: [3226:3226]
    depends_on: [backend]
  
  backend:
    build: ./backend
    ports: [5000:5000]
    environment:
      - MONGO_URI=mongodb://mongo:27017
      - PYTHONMODEL=http://ml:8000
    depends_on: [mongo, ml]
  
  ml:
    build: ./backend/pythonmodel
    ports: [8000:8000]
  
  mongo:
    image: mongo:6.0
    ports: [27017:27017]
    volumes:
      - mongo_data:/data/db
  
  redis:
    image: redis:7.0
    ports: [6379:6379]

volumes:
  mongo_data:
```

---

## 14. Summary

This LLD provides a comprehensive architectural overview of the Sentinel AI Monitor system, including:

✅ Component structure and interactions
✅ Data models and database schema
✅ API endpoints and request/response formats
✅ Service layer responsibilities
✅ ML pipeline processing flow
✅ Real-time communication mechanisms
✅ Authentication and authorization
✅ Error handling and logging
✅ Performance and scaling strategies
✅ Deployment configuration

The system is designed with separation of concerns, scalability, and maintainability in mind, following industry best practices for enterprise applications.

