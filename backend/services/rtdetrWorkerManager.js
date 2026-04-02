import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Camera from "../models/Camera.js";
import { env } from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, "..");

const DEFAULT_WORKER_SCRIPT = path.join(BACKEND_ROOT, "pythonmodel", "rtdetr_crowd_worker.py");
const DEFAULT_MODEL_PATH = path.join(BACKEND_ROOT, "rtdetr-l.pt");

const workers = new Map();
let syncIntervalId = null;
let shuttingDown = false;

const toAbsolutePath = (value, fallbackAbsolutePath = "") => {
	const raw = typeof value === "string" ? value.trim() : "";
	const selected = raw || fallbackAbsolutePath;

	if (!selected) {
		return "";
	}

	return path.isAbsolute(selected) ? selected : path.resolve(BACKEND_ROOT, selected);
};

const resolveWorkerScript = () => toAbsolutePath(env.RTDETR_WORKER_SCRIPT, DEFAULT_WORKER_SCRIPT);

const resolveModelPath = () => {
	const configured = typeof env.RTDETR_MODEL_PATH === "string" ? env.RTDETR_MODEL_PATH.trim() : "";

	// Allow built-in model names like "rtdetr-l.pt" to be resolved by Ultralytics.
	if (configured && !configured.includes("/") && !configured.includes(path.sep)) {
		return configured;
	}

	return toAbsolutePath(configured, DEFAULT_MODEL_PATH);
};

const resolvePythonExecutable = () => {
	const configured = typeof env.RTDETR_PYTHON_EXECUTABLE === "string" ? env.RTDETR_PYTHON_EXECUTABLE.trim() : "";
	if (configured) {
		return configured;
	}

	if (process.env.VIRTUAL_ENV) {
		return path.join(process.env.VIRTUAL_ENV, "bin", "python");
	}

	return "python3";
};

const normalizeSystemDeviceIndex = (value) => {
	if (Number.isInteger(value) && value >= 0) {
		return value;
	}

	const raw = typeof value === "string" ? value.trim() : "";
	if (!raw) {
		return null;
	}

	if (/^\d+$/.test(raw)) {
		return Number.parseInt(raw, 10);
	}

	const namedIndexMatch = raw.match(/^(?:camera|cam|video)\s*(\d+)$/i);
	if (namedIndexMatch) {
		return Number.parseInt(namedIndexMatch[1], 10);
	}

	return null;
};

const parseSystemDeviceIndexFromRtspUrl = (rtspUrlValue) => {
	const rtspUrl = typeof rtspUrlValue === "string" ? rtspUrlValue.trim() : "";
	if (!rtspUrl.toLowerCase().startsWith("system://")) {
		return null;
	}

	const encodedDevicePart = rtspUrl.slice("system://".length).trim();
	if (!encodedDevicePart) {
		return null;
	}

	let decodedDevicePart = encodedDevicePart;
	try {
		decodedDevicePart = decodeURIComponent(encodedDevicePart);
	} catch {
		decodedDevicePart = encodedDevicePart;
	}

	return normalizeSystemDeviceIndex(decodedDevicePart);
};

const resolveSystemDeviceIndex = (camera) =>
	normalizeSystemDeviceIndex(camera?.deviceIndex) ??
	parseSystemDeviceIndexFromRtspUrl(camera?.rtspUrl) ??
	normalizeSystemDeviceIndex(camera?.deviceId) ??
	0;

const resolveCameraSource = (camera) => {
	const sourceType = String(camera?.sourceType || "RTSP").toUpperCase();
	const rtspUrl = String(camera?.rtspUrl || "").trim();
	const deviceId = String(camera?.deviceId || "").trim();

	if (sourceType === "SYSTEM") {
		const systemDeviceIndex = resolveSystemDeviceIndex(camera);
		if (Number.isInteger(systemDeviceIndex) && systemDeviceIndex >= 0) {
			return `system://${systemDeviceIndex}`;
		}

		if (rtspUrl.startsWith("system://")) {
			return rtspUrl;
		}

		if (deviceId) {
			return `system://${encodeURIComponent(deviceId)}`;
		}

		return "system://0";
	}

	return rtspUrl;
};

const waitForProcessExit = (childProcess, timeoutMs) =>
	new Promise((resolve) => {
		if (!childProcess || childProcess.exitCode !== null) {
			resolve(true);
			return;
		}

		let timeoutId = null;

		const cleanup = () => {
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
			}
			childProcess.off("exit", onExit);
			childProcess.off("error", onError);
		};

		const onExit = () => {
			cleanup();
			resolve(true);
		};

		const onError = () => {
			cleanup();
			resolve(true);
		};

		childProcess.once("exit", onExit);
		childProcess.once("error", onError);

		timeoutId = setTimeout(() => {
			cleanup();
			resolve(false);
		}, Math.max(0, Number(timeoutMs) || 0));

		if (typeof timeoutId.unref === "function") {
			timeoutId.unref();
		}
	});

const buildWorkerArgs = (camera) => {
	const args = [
		resolveWorkerScript(),
		"--model-path",
		resolveModelPath(),
		"--source",
		resolveCameraSource(camera),
		"--camera-id",
		String(camera._id),
		"--api-base-url",
		env.RTDETR_API_BASE_URL,
		"--input-size",
		String(env.RTDETR_INPUT_SIZE),
		"--score-threshold",
		String(env.RTDETR_SCORE_THRESHOLD),
		"--iou-threshold",
		String(env.RTDETR_IOU_THRESHOLD),
		"--max-detections",
		String(env.RTDETR_MAX_DETECTIONS),
		"--min-box-area-ratio",
		String(env.RTDETR_MIN_BOX_AREA_RATIO),
		"--max-box-area-ratio",
		String(env.RTDETR_MAX_BOX_AREA_RATIO),
		"--frame-skip",
		String(env.RTDETR_FRAME_SKIP),
		"--status-heartbeat-seconds",
		String(env.RTDETR_STATUS_HEARTBEAT_SECONDS),
		"--backend-timeout-seconds",
		String(env.RTDETR_BACKEND_TIMEOUT_SECONDS),
		"--reconnect-delay-seconds",
		String(env.RTDETR_RECONNECT_DELAY_SECONDS),
		"--device",
		String(env.RTDETR_DEVICE),
		"--log-every-frames",
		String(env.RTDETR_LOG_EVERY_FRAMES),
	];

	if (env.RTDETR_ALL_CLASSES) {
		args.push("--all-classes");
	} else {
		args.push("--person-class-id", String(env.RTDETR_PERSON_CLASS_ID));
	}

	if (env.RTDETR_HALF) {
		args.push("--half");
	}

	if (env.RTDETR_SEND_EMPTY) {
		args.push("--send-empty");
	}

	if (env.RTDETR_SHOW_PREVIEW) {
		args.push("--show-preview");
	}

	if (Array.isArray(env.RTDETR_EXCLUDE_CLASS_IDS) && env.RTDETR_EXCLUDE_CLASS_IDS.length > 0) {
		args.push("--exclude-class-ids", env.RTDETR_EXCLUDE_CLASS_IDS.join(","));
	}

	if (env.RTDETR_DEBUG_LOG_PAYLOAD) {
		args.push("--debug-log-payload");
	}

	if (env.WORKER_API_KEY) {
		args.push("--worker-api-key", env.WORKER_API_KEY);
	}

	return args;
};

const validateRuntimeConfig = () => {
	const workerScriptPath = resolveWorkerScript();
	if (!workerScriptPath || !workerScriptPath.endsWith(".py")) {
		throw new Error("RT-DETR worker script path is invalid.");
	}

	if (!fs.existsSync(workerScriptPath)) {
		throw new Error(`RT-DETR worker script not found: ${workerScriptPath}`);
	}

	const modelPath = resolveModelPath();
	const builtInModelName =
		modelPath.endsWith(".pt") && !modelPath.includes("/") && !modelPath.includes(path.sep);

	if (!builtInModelName && !fs.existsSync(modelPath)) {
		throw new Error(`RT-DETR model file not found: ${modelPath}`);
	}
};

const scheduleRestartIfNeeded = async (cameraId) => {
	if (shuttingDown || !env.RTDETR_WORKER_ENABLED) {
		return;
	}

	const restartDelay = Math.max(0, Number(env.RTDETR_RESTART_DELAY_MS) || 0);

	const timeoutId = setTimeout(async () => {
		if (shuttingDown || workers.has(cameraId)) {
			return;
		}

		try {
			const camera = await Camera.findById(cameraId).select(
				"_id status sourceType rtspUrl deviceId deviceIndex",
			);
			if (!camera || camera.status !== "ONLINE") {
				return;
			}

			await startWorkerForCamera(camera, { forceRestart: true });
		} catch (error) {
			console.error(`[rtdetr-manager] Failed to auto-restart worker for camera=${cameraId}:`, error.message);
		}
	}, restartDelay);

	if (typeof timeoutId.unref === "function") {
		timeoutId.unref();
	}
};

export const startWorkerForCamera = async (camera, options = {}) => {
	if (!env.RTDETR_WORKER_ENABLED) {
		return { started: false, reason: "disabled" };
	}

	if (!camera || !camera._id) {
		throw new Error("Camera is required to start RT-DETR worker.");
	}

	const cameraId = String(camera._id);
	const existing = workers.get(cameraId);

	if (existing && existing.process.exitCode === null && !options.forceRestart) {
		return { started: false, reason: "already-running", pid: existing.process.pid };
	}

	if (existing) {
		await stopWorkerForCamera(cameraId, { reason: "force-restart" });
	}

	const sourceType = String(camera?.sourceType || "RTSP").toUpperCase();
	const systemDeviceIndex = sourceType === "SYSTEM" ? resolveSystemDeviceIndex(camera) : null;

	if (sourceType === "SYSTEM") {
		const conflictingWorker = Array.from(workers.values()).find(
			(record) =>
				record.cameraId !== cameraId &&
				record.stopping !== true &&
				record.process?.exitCode === null &&
				record.sourceType === "SYSTEM" &&
				record.systemDeviceIndex === systemDeviceIndex,
		);

		if (conflictingWorker) {
			throw new Error(
				`SYSTEM camera device index ${systemDeviceIndex} is already used by camera ${conflictingWorker.cameraId}`,
			);
		}
	}

	validateRuntimeConfig();

	const args = buildWorkerArgs(camera);
	const pythonExecutable = resolvePythonExecutable();

	console.log(`[rtdetr-manager] Starting worker camera=${cameraId} model=${resolveModelPath()}`);

	const childProcess = spawn(pythonExecutable, args, {
		cwd: BACKEND_ROOT,
		env: {
			...process.env,
			PYTHONUNBUFFERED: "1",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

	const record = {
		process: childProcess,
		cameraId,
		stopping: false,
		sourceType,
		systemDeviceIndex,
	};

	workers.set(cameraId, record);

	childProcess.stdout?.on("data", (chunk) => {
		const text = chunk.toString().trim();
		if (text) {
			console.log(`[rtdetr:${cameraId}] ${text}`);
		}
	});

	childProcess.stderr?.on("data", (chunk) => {
		const text = chunk.toString().trim();
		if (text) {
			console.error(`[rtdetr:${cameraId}] ${text}`);
		}
	});

	childProcess.on("error", (error) => {
		console.error(`[rtdetr-manager] Worker process error camera=${cameraId}:`, error.message);
	});

	childProcess.on("exit", (code, signal) => {
		const current = workers.get(cameraId);
		const wasStopping = Boolean(current?.stopping) || shuttingDown;

		workers.delete(cameraId);

		if (wasStopping) {
			console.log(`[rtdetr-manager] Worker stopped camera=${cameraId} code=${code} signal=${signal}`);
			return;
		}

		console.warn(
			`[rtdetr-manager] Worker exited unexpectedly camera=${cameraId} code=${code} signal=${signal}. Scheduling restart.`,
		);
		void scheduleRestartIfNeeded(cameraId);
	});

	return { started: true, pid: childProcess.pid };
};

export const stopWorkerForCamera = async (cameraId, options = {}) => {
	const id = String(cameraId || "");
	if (!id) {
		return false;
	}

	const record = workers.get(id);
	if (!record) {
		return false;
	}

	record.stopping = true;

	const childProcess = record.process;
	if (!childProcess || childProcess.exitCode !== null) {
		workers.delete(id);
		return true;
	}

	const reason = options.reason ? ` reason=${options.reason}` : "";
	console.log(`[rtdetr-manager] Stopping worker camera=${id}${reason}`);

	childProcess.kill("SIGTERM");

	const didExitGracefully = await waitForProcessExit(childProcess, env.RTDETR_SHUTDOWN_GRACE_MS);
	if (!didExitGracefully && childProcess.exitCode === null) {
		childProcess.kill("SIGKILL");
		await waitForProcessExit(childProcess, 1000);
	}

	workers.delete(id);
	return true;
};

export const syncWorkersWithCameraStatuses = async () => {
	if (!env.RTDETR_WORKER_ENABLED || shuttingDown) {
		return;
	}

	const onlineCameras = await Camera.find({ status: "ONLINE" }).select(
		"_id status sourceType rtspUrl deviceId deviceIndex",
	);
	const onlineSet = new Set(onlineCameras.map((camera) => String(camera._id)));
	const reservedSystemIndices = new Set();

	for (const camera of onlineCameras) {
		if (String(camera?.sourceType || "RTSP").toUpperCase() === "SYSTEM") {
			const systemDeviceIndex = resolveSystemDeviceIndex(camera);
			if (reservedSystemIndices.has(systemDeviceIndex)) {
				console.warn(
					`[rtdetr-manager] Skipping duplicate ONLINE system camera=${camera._id} deviceIndex=${systemDeviceIndex}`,
				);
				await stopWorkerForCamera(String(camera._id), { reason: "duplicate-system-index" });
				continue;
			}

			reservedSystemIndices.add(systemDeviceIndex);
		}

		try {
			await startWorkerForCamera(camera);
		} catch (error) {
			console.error(`[rtdetr-manager] Failed to start worker camera=${camera._id}:`, error.message);
		}
	}

	const workerIds = Array.from(workers.keys());
	for (const cameraId of workerIds) {
		if (!onlineSet.has(cameraId)) {
			await stopWorkerForCamera(cameraId, { reason: "camera-offline-sync" });
		}
	}
};

export const initializeRTDETRWorkerManager = async () => {
	if (!env.RTDETR_WORKER_ENABLED) {
		console.log("[rtdetr-manager] Disabled by RTDETR_WORKER_ENABLED=false");
		return;
	}

	shuttingDown = false;

	if (env.RTDETR_AUTO_START_ON_BOOT) {
		await syncWorkersWithCameraStatuses();
	}

	if (syncIntervalId) {
		clearInterval(syncIntervalId);
	}

	syncIntervalId = setInterval(() => {
		syncWorkersWithCameraStatuses().catch((error) => {
			console.error("[rtdetr-manager] Worker sync failed:", error.message);
		});
	}, Math.max(1, env.RTDETR_SYNC_INTERVAL_SECONDS) * 1000);

	if (typeof syncIntervalId.unref === "function") {
		syncIntervalId.unref();
	}

	console.log("[rtdetr-manager] Initialized");
};

export const shutdownRTDETRWorkerManager = async () => {
	shuttingDown = true;

	if (syncIntervalId) {
		clearInterval(syncIntervalId);
		syncIntervalId = null;
	}

	const workerIds = Array.from(workers.keys());
	await Promise.all(workerIds.map((cameraId) => stopWorkerForCamera(cameraId, { reason: "shutdown" })));
};

export const getWorkerRuntimeSnapshot = () =>
	Array.from(workers.entries()).map(([cameraId, record]) => ({
		cameraId,
		pid: record.process.pid,
		stopping: record.stopping,
		sourceType: record.sourceType,
		systemDeviceIndex: record.systemDeviceIndex,
	}));
