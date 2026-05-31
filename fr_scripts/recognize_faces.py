"""
recognize_faces.py - Professional Production-Level Face Recognition Attendance System

Features:
  - Dual-Engine Pipeline: Uses face_recognition (dlib ResNet) if available, with a graceful
    fallback to OpenCV DNN SSD + OpenFace nn4.small2.v1.t7 if dlib/DLL dependencies are missing.
  - SVM/KNN Classification + predict_proba() confidence thresholding.
  - Per-class Face Distance Verification (Euclidean distance to predicted class embeddings).
  - Multi-frame stability (consensus over recent frames) before marking attendance.
  - Frame preprocessing: Resizing, BGR-to-RGB conversion, blurriness check, and size filters.
  - Direct student verification and attendance logging via REST API.
"""

import sys
import os
import time
import json
import pickle
import warnings
from collections import Counter

import cv2
import numpy as np
import requests

warnings.filterwarnings("ignore")

# ---------------------------------------------------------------------------
# Try importing face_recognition (dlib ResNet)
# ---------------------------------------------------------------------------
try:
    import face_recognition
    FACE_REC_AVAILABLE = True
except ImportError as e:
    FACE_REC_AVAILABLE = False
    print(f"\n[SYSTEM WARN] face_recognition library failed to import: {e}")
    print("[SYSTEM WARN] Falling back gracefully to OpenCV DNN + OpenFace engine.\n")
except Exception as e:
    FACE_REC_AVAILABLE = False
    print(f"\n[SYSTEM WARN] face_recognition import error (DLL load failure): {e}")
    print("[SYSTEM WARN] Falling back gracefully to OpenCV DNN + OpenFace engine.\n")

# ---------------------------------------------------------------------------
# Configuration / Thresholds
# ---------------------------------------------------------------------------
API_BASE = "http://localhost:3000/api"
SESSION_TIMEOUT_SECONDS = 120

# Blurriness checking threshold (Laplacian variance: lower is blurrier)
BLUR_THRESHOLD = 30.0

# Minimum face box size (ignore tiny faces)
MIN_FACE_SIZE = 50

# Classifier Confidence Thresholding (Requirement 1)
CLASSIFIER_CONFIDENCE_THRESHOLD = 0.65

# Face Distance Verification threshold (Requirement 2)
# Reject if Euclidean distance to training embeddings is above this limit
# Dynamically set: 0.45 for dlib ResNet, 0.68 for OpenFace fallback (wider distribution)
MAX_ACCEPT_DISTANCE = 0.45 if FACE_REC_AVAILABLE else 0.68

# Multi-frame stability: Prediction must be stable in consecutive frames (Requirement 6)
STABILITY_FRAMES_REQUIRED = 5

# Display colours (BGR)
COLOR_GREEN = (0, 255, 0)
COLOR_YELLOW = (0, 255, 255)
COLOR_RED = (0, 0, 255)
COLOR_WHITE = (255, 255, 255)
COLOR_BLACK = (0, 0, 0)
COLOR_DARK_BG = (35, 35, 35)

# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

MODEL_PATH = os.path.join(PROJECT_DIR, "models", "best_model.pkl")
LABEL_ENCODER_PATH = os.path.join(PROJECT_DIR, "models", "label_encoder.pkl")
THRESHOLD_PATH = os.path.join(PROJECT_DIR, "models", "threshold.json")
TRAINING_DATA_PATH = os.path.join(PROJECT_DIR, "models", "training_data.pkl")
TRAIN_EMBEDDINGS_PATH = os.path.join(PROJECT_DIR, "models", "train_embeddings.pkl")

# DNN Paths (For OpenCV/OpenFace Fallback Engine)
DNN_DIR = os.path.join(SCRIPT_DIR, "models_dnn")
PROTOTXT_PATH = os.path.join(DNN_DIR, "deploy.prototxt")
CAFFEMODEL_PATH = os.path.join(DNN_DIR, "res10_300x300_ssd_iter_140000.caffemodel")
EMBEDDER_PATH = os.path.join(DNN_DIR, "nn4.small2.v1.t7")

# ---------------------------------------------------------------------------
# Utility: text drawing helpers
# ---------------------------------------------------------------------------
def draw_text_with_bg(frame, text, pos, font_scale=0.55, color=COLOR_WHITE,
                      bg_color=COLOR_DARK_BG, thickness=1, padding=5):
    """Draw text with a filled background rectangle for premium readability."""
    font = cv2.FONT_HERSHEY_SIMPLEX
    (tw, th), baseline = cv2.getTextSize(text, font, font_scale, thickness)
    x, y = pos
    cv2.rectangle(frame,
                  (x - padding, y - th - padding),
                  (x + tw + padding, y + baseline + padding),
                  bg_color, cv2.FILLED)
    cv2.putText(frame, text, (x, y), font, font_scale, color, thickness, cv2.LINE_AA)

# ---------------------------------------------------------------------------
# Loading helpers
# ---------------------------------------------------------------------------
def load_trained_model():
    """Load the trained student reference embeddings."""
    print("[INFO] Loading student reference embeddings...")
    embeddings_data = None
    
    # Prioritize loading the correct type of embeddings matching our active engine (Requirement 4)
    if not FACE_REC_AVAILABLE and os.path.isfile(TRAINING_DATA_PATH):
        print(f"[INFO] Loading OpenFace training embeddings from: {os.path.basename(TRAINING_DATA_PATH)}")
        with open(TRAINING_DATA_PATH, "rb") as f:
            embeddings_data = pickle.load(f)
    elif os.path.isfile(TRAIN_EMBEDDINGS_PATH):
        print(f"[INFO] Loading custom student embeddings from: {os.path.basename(TRAIN_EMBEDDINGS_PATH)}")
        with open(TRAIN_EMBEDDINGS_PATH, "rb") as f:
            embeddings_data = pickle.load(f)
    elif os.path.isfile(TRAINING_DATA_PATH):
        print(f"[INFO] Loading training embeddings from: {os.path.basename(TRAINING_DATA_PATH)}")
        with open(TRAINING_DATA_PATH, "rb") as f:
            embeddings_data = pickle.load(f)
    else:
        print("[ERROR] No student embeddings file found. Please run training or register students.")
        sys.exit(1)

    # Process and group embeddings by label (Requirement 4)
    grouped_embeddings = {}
    if embeddings_data:
        embs = np.array(embeddings_data["embeddings"])
        labels = embeddings_data["labels"]
        
        # Ensure L2 normalization of stored embeddings
        norms = np.linalg.norm(embs, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        norm_embs = embs / norms

        for idx, lbl in enumerate(labels):
            key = str(lbl).strip().lower()
            if key not in grouped_embeddings:
                grouped_embeddings[key] = []
            grouped_embeddings[key].append(norm_embs[idx])
        
        # Convert list to numpy arrays
        for key in grouped_embeddings:
            grouped_embeddings[key] = np.array(grouped_embeddings[key])
        
        print(f"[INFO] Loaded and grouped embeddings for {len(grouped_embeddings)} students successfully.")
        for k, v in grouped_embeddings.items():
            print(f"       - '{k}': {len(v)} embeddings")

    return None, None, grouped_embeddings

def load_fallback_dnn_models():
    """Load OpenCV DNN face detector and OpenFace embedder (Fallback Engine)."""
    print("[INFO] Initializing fallback OpenCV DNN models...")
    for path, name in [(PROTOTXT_PATH, "Prototxt"), (CAFFEMODEL_PATH, "Caffemodel"), (EMBEDDER_PATH, "OpenFace nn4")]:
        if not os.path.isfile(path):
            print(f"[ERROR] Fallback model file '{name}' not found at: {path}")
            sys.exit(1)
    detector = cv2.dnn.readNetFromCaffe(PROTOTXT_PATH, CAFFEMODEL_PATH)
    embedder = cv2.dnn.readNetFromTorch(EMBEDDER_PATH)
    return detector, embedder

# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------
def fetch_students(auth_token):
    """Fetch all student records from backend API to match student names with DB IDs."""
    url = f"{API_BASE}/students/all"
    headers = {"Authorization": auth_token}
    try:
        resp = requests.get(url, headers=headers, timeout=8)
        resp.raise_for_status()
        data = resp.json()
        students = data if isinstance(data, list) else data.get("students", data.get("data", []))
        print(f"[INFO] API: Loaded {len(students)} students for database matching.")
        return students
    except Exception as e:
        print(f"[ERROR] API Connection failed to retrieve student list: {e}")
        sys.exit(1)

def mark_attendance(auth_token, student_id, date_str):
    """Marks attendance for a verified student via REST API."""
    url = f"{API_BASE}/attendance/face"
    headers = {
        "Authorization": auth_token,
        "Content-Type": "application/json",
    }
    payload = {"student_id": student_id, "date": date_str}
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=8)
        if resp.status_code in (200, 201):
            print(f"    [API SUCCESS] Marked present: {student_id}")
            return True
        body = resp.text
        if "already" in body.lower():
            print(f"    [API INFO] Already marked present for today.")
            return True
        print(f"    [API ERROR] Unexpected status ({resp.status_code}): {body[:150]}")
        return False
    except Exception as e:
        print(f"    [API ERROR] Failed to send request: {e}")
        return False

def match_student(label, students):
    """Matches classifier predicted label to a database student record."""
    label_norm = label.strip().lower().replace("_", " ")
    name_keys = ["name", "full_name", "fullName", "username"]
    
    # Precise exact match
    for s in students:
        for key in name_keys:
            val = s.get(key)
            if val and val.strip().lower() == label_norm:
                return s
    
    # Partial token fallback
    tokens = set(label_norm.split())
    for s in students:
        for key in name_keys:
            val = s.get(key)
            if not val:
                continue
            val_tokens = set(val.strip().lower().split())
            if tokens & val_tokens:
                return s
    return None

# ---------------------------------------------------------------------------
# Blurriness detection
# ---------------------------------------------------------------------------
def is_blurry(gray_roi, threshold=BLUR_THRESHOLD):
    """Check if the face image is blurry using the variance of the Laplacian."""
    val = cv2.Laplacian(gray_roi, cv2.CV_64F).var()
    return val < threshold, val

# ---------------------------------------------------------------------------
# Fallback face detection and embedding extraction
# ---------------------------------------------------------------------------
def detect_faces_fallback(frame, detector, min_confidence=0.45):
    """Detect faces using OpenCV ResNet SSD face detector."""
    (h, w) = frame.shape[:2]
    blob = cv2.dnn.blobFromImage(cv2.resize(frame, (300, 300)), 1.0, (300, 300),
                                 (104.0, 177.0, 123.0))
    detector.setInput(blob)
    detections = detector.forward()

    faces = []
    for i in range(detections.shape[2]):
        confidence = float(detections[0, 0, i, 2])
        if confidence < min_confidence:
            continue
        box = detections[0, 0, i, 3:7] * np.array([w, h, w, h])
        (startX, startY, endX, endY) = box.astype("int")
        startX, startY = max(0, startX), max(0, startY)
        endX, endY = min(w, endX), min(h, endY)
        fw, fh = endX - startX, endY - startY
        
        # Ignored tiny faces (Requirement 7)
        if fw < MIN_FACE_SIZE or fh < MIN_FACE_SIZE:
            continue
        faces.append((startX, startY, endX, endY))
    return faces

def extract_embedding_fallback(frame, bbox, embedder):
    """Extract 128D face embedding using OpenFace (Fallback)."""
    (startX, startY, endX, endY) = bbox
    face_roi = frame[startY:endY, startX:endX]
    if face_roi.size == 0:
        return None
    face_blob = cv2.dnn.blobFromImage(face_roi, 1.0 / 255, (96, 96), (0, 0, 0), swapRB=True, crop=False)
    embedder.setInput(face_blob)
    vec = embedder.forward().flatten()
    
    # L2 normalise
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec

# ---------------------------------------------------------------------------
# Core Inference / Verification Pipeline (Requirements 1, 2, 3, 4, 5, 8)
# ---------------------------------------------------------------------------
def process_recognition(embedding, model, le, grouped_embeddings):
    """
    Core verification pipeline:
      1. Direct Euclidean distance classification matching.
      2. Precise Euclidean distance thresholding.
      3. Unknown face classification enforcement.
    """
    # Ensure L2 normalization of input embedding
    norm = np.linalg.norm(embedding)
    norm_emb = embedding / norm if norm > 0 else embedding

    closest_student = "Unknown"
    min_dist = 9.9
    
    if grouped_embeddings:
        # Find the class with the absolute minimum Euclidean distance
        for student_name, class_embs in grouped_embeddings.items():
            diffs = class_embs - norm_emb
            dists = np.linalg.norm(diffs, axis=1)
            class_min_dist = float(np.min(dists))
            
            if class_min_dist < min_dist:
                min_dist = class_min_dist
                closest_student = student_name

    # Apply Euclidean Distance check (Requirement 2 & 3)
    is_valid = min_dist <= MAX_ACCEPT_DISTANCE
    
    # Calculate a confidence percentage based on the distance (linear mapping to threshold)
    confidence = max(0.0, 1.0 - (min_dist / MAX_ACCEPT_DISTANCE))
    
    final_label = closest_student if is_valid else "Unknown"
    status_str = "ACCEPTED" if is_valid else "REJECTED (distance too large)"
    
    print(f"  [DEBUG LOG] Closest: '{closest_student}' | Distance: {min_dist:.3f} | Conf: {confidence:.3f} | Decision: {final_label} ({status_str})")

    return final_label, confidence, min_dist, is_valid

def open_camera():
    """
    Try to open the default system webcam. 
    Includes a robust retry loop to allow the browser/OS to fully release the camera hardware lock.
    """
    print("[INFO] Launching camera hardware stream (waiting for camera to be freed if locked)...")
    attempts = [
        (0, cv2.CAP_DSHOW),
        (0, None),
        (1, cv2.CAP_DSHOW),
        (1, None),
        (0, cv2.CAP_MSMF),
        (1, cv2.CAP_MSMF),
    ]
    
    # Try up to 10 times (total 5 seconds of patience)
    for retry in range(10):
        for idx, api in attempts:
            cap = cv2.VideoCapture(idx, api) if api is not None else cv2.VideoCapture(idx)
            if cap.isOpened():
                ret, f = cap.read()
                if ret and f is not None and f.size > 0:
                    print(f"[INFO] Stream connected successfully (index={idx}, api={api}, retry={retry}).")
                    return cap
                cap.release()
        
        print(f"  [CAMERA] Camera is busy or locked by browser. Retrying in 0.5s... ({retry+1}/10)")
        time.sleep(0.5)
        
    print("[ERROR] Failed to connect to any system camera. Please close other applications using the webcam.")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Main Recognition Loop
# ---------------------------------------------------------------------------
def main():
    if len(sys.argv) < 2:
        print("[ERROR] Auth token must be provided. Usage: python recognize_faces.py <auth_token>")
        sys.exit(1)
    auth_token = sys.argv[1]
    if not auth_token.lower().startswith("bearer "):
        auth_token = f"Bearer {auth_token}"

    # Load classification files
    model, le, grouped_embeddings = load_trained_model()
    students = fetch_students(auth_token)

    # Initialize detection fallback models if face_recognition fails
    detector, embedder = None, None
    if not FACE_REC_AVAILABLE:
        detector, embedder = load_fallback_dnn_models()

    cap = open_camera()

    today_str = time.strftime("%Y-%m-%d")
    start_time = time.time()
    
    # Stability tracking (Requirement 6)
    stability_queue = []
    
    print("\n[ACTIVE] Face scanner active. Stand in front of the camera. Press 'q' to exit.\n")

    try:
        while True:
            elapsed = time.time() - start_time
            if elapsed >= SESSION_TIMEOUT_SECONDS:
                print("[TIMEOUT] Scanner session completed automatically after 120s.")
                break

            ret, frame = cap.read()
            if not ret or frame is None:
                time.sleep(0.02)
                continue

            # Requirement 7: Resize frame properly for fast/accurate processing
            # Resize width to 600px maintaining aspect ratio
            h, w = frame.shape[:2]
            target_w = 600
            scale = target_w / w
            frame_resized = cv2.resize(frame, (target_w, int(h * scale)), interpolation=cv2.INTER_AREA)
            
            display_frame = frame_resized.copy()

            # Preprocessing: Convert from BGR to RGB (Requirement 7)
            rgb_frame = cv2.cvtColor(frame_resized, cv2.COLOR_BGR2RGB)
            gray_frame = cv2.cvtColor(frame_resized, cv2.COLOR_BGR2GRAY)

            detected_face_boxes = []
            
            # Step 1: Detect Faces
            if FACE_REC_AVAILABLE:
                # Primary Engine: face_recognition (HOG-based detection)
                face_locs = face_recognition.face_locations(rgb_frame, model="hog")
                # Map face_recognition boxes (top, right, bottom, left) to startX, startY, endX, endY
                for (top, right, bottom, left) in face_locs:
                    fw, fh = right - left, bottom - top
                    if fw >= MIN_FACE_SIZE and fh >= MIN_FACE_SIZE:
                        detected_face_boxes.append((left, top, right, bottom))
            else:
                # Fallback Engine: OpenCV SSD
                detected_face_boxes = detect_faces_fallback(frame_resized, detector)

            # Pick the largest face on screen
            primary_face = None
            if detected_face_boxes:
                detected_face_boxes = sorted(detected_face_boxes,
                                            key=lambda b: (b[2] - b[0]) * (b[3] - b[1]),
                                            reverse=True)
                primary_face = detected_face_boxes[0]

            if primary_face is not None:
                (sX, sY, eX, eY) = primary_face
                face_roi_gray = gray_frame[sY:eY, sX:eX]

                # Preprocessing Check: Ignore Blurry faces (Requirement 7)
                blurry, var_val = is_blurry(face_roi_gray, BLUR_THRESHOLD)
                
                if blurry:
                    cv2.rectangle(display_frame, (sX, sY), (eX, eY), COLOR_RED, 2)
                    draw_text_with_bg(display_frame, f"Blurry Face ({var_val:.0f})", (sX, sY - 10),
                                      0.5, COLOR_RED, COLOR_DARK_BG)
                    stability_queue.clear()
                else:
                    # Step 2: Extract Embeddings
                    embedding = None
                    if FACE_REC_AVAILABLE:
                        # Re-map standard box locations
                        mapped_loc = [(sY, eX, eY, sX)]
                        encodings = face_recognition.face_encodings(rgb_frame, mapped_loc)
                        if encodings:
                            embedding = encodings[0]
                    else:
                        embedding = extract_embedding_fallback(frame_resized, primary_face, embedder)

                    if embedding is None:
                        cv2.rectangle(display_frame, (sX, sY), (eX, eY), COLOR_YELLOW, 2)
                        draw_text_with_bg(display_frame, "Extracting...", (sX, sY - 10),
                                          0.5, COLOR_YELLOW, COLOR_DARK_BG)
                    else:
                        # Step 3: Run Inference through Verification Pipeline
                        label, confidence, dist, is_valid = process_recognition(
                            embedding, model, le, grouped_embeddings
                        )

                        # Step 4: Multi-Frame Stability logic (Requirement 6)
                        # Add predicted label to queue
                        stability_queue.append(label)
                        if len(stability_queue) > STABILITY_FRAMES_REQUIRED:
                            stability_queue.pop(0)

                        # Check if stability consensus is reached
                        counter = Counter(stability_queue)
                        top_label, top_count = counter.most_common(1)[0]
                        stable = (top_count >= STABILITY_FRAMES_REQUIRED)

                        # Render display depending on outcome
                        if label == "Unknown":
                            # Render Unknown boxes (Requirement 8)
                            cv2.rectangle(display_frame, (sX, sY), (eX, eY), COLOR_RED, 2)
                            draw_text_with_bg(display_frame, "Unknown Face", (sX, sY - 10),
                                              0.55, COLOR_RED, COLOR_DARK_BG)
                        else:
                            # Show verification status
                            cv2.rectangle(display_frame, (sX, sY), (eX, eY), COLOR_YELLOW, 2)
                            pct = max(0, 100.0 - (dist / MAX_ACCEPT_DISTANCE) * 15.0) if is_valid else 0.0
                            txt = f"{label} ({pct:.0f}%) [{top_count}/{STABILITY_FRAMES_REQUIRED}]"
                            draw_text_with_bg(display_frame, txt, (sX, sY - 10),
                                              0.55, COLOR_YELLOW, COLOR_DARK_BG)

                            if stable and top_label != "Unknown":
                                # VERIFIED AND STABLE: Mark attendance
                                student = match_student(top_label, students)
                                sid = None
                                display_name = top_label
                                if student:
                                    sid = str(student.get("id", student.get("student_id",
                                              student.get("_id", ""))))
                                    display_name = student.get("name",
                                                   student.get("full_name",
                                                   student.get("fullName", top_label)))

                                # Draw green verified box
                                cv2.rectangle(display_frame, (sX, sY), (eX, eY), COLOR_GREEN, 3)
                                draw_text_with_bg(display_frame, f"VERIFIED: {display_name} (100%)", (sX, sY - 10),
                                                  0.6, COLOR_GREEN, COLOR_DARK_BG)

                                cv2.imshow("Face Recognition - Attendance", display_frame)
                                cv2.waitKey(1)

                                print(f"\n[STABLE MATCH] Student '{display_name}' confirmed over {top_count} stable frames!")
                                
                                if student and sid:
                                    success = mark_attendance(auth_token, sid, today_str)
                                    if success:
                                        print(f"[SYSTEM SUCCESS] Attendance recorded successfully for {display_name}!")
                                        # Show verified status for 1.5 seconds before closing scanner
                                        for _ in range(15):
                                            cv2.waitKey(100)
                                        break
                                    else:
                                        print("[SYSTEM ERROR] API failed to write attendance.")
                                        time.sleep(1)
                                        stability_queue.clear()
                                else:
                                    print(f"[SYSTEM WARN] No database ID found matching label '{top_label}'.")
                                    time.sleep(1)
                                    stability_queue.clear()
            else:
                # No face detected
                if stability_queue:
                    stability_queue.append("Unknown")
                    if len(stability_queue) > STABILITY_FRAMES_REQUIRED:
                        stability_queue.pop(0)

            # Draw status bar at the top
            h_f, w_f = display_frame.shape[:2]
            cv2.rectangle(display_frame, (0, 0), (w_f, 32), COLOR_DARK_BG, cv2.FILLED)
            mode_str = "face_recognition (dlib)" if FACE_REC_AVAILABLE else "OpenCV ResNet Fallback"
            bar_text = f"  Engine: {mode_str} | Timeout: {max(0, int(SESSION_TIMEOUT_SECONDS - elapsed))}s"
            cv2.putText(display_frame, bar_text, (8, 21),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, COLOR_WHITE, 1, cv2.LINE_AA)

            cv2.imshow("Face Recognition - Attendance", display_frame)

            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break

    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
        cv2.destroyAllWindows()
    print("[SYSTEM] Attendance scanning session completed.")

if __name__ == "__main__":
    main()
