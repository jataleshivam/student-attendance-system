"""
capture_faces.py - Face Capture Script for Training Data Collection
===================================================================
Captures face images from a webcam for training a face recognition model.

Usage:
    python capture_faces.py <student_id> <student_name>

Example:
    python capture_faces.py 101 "John Doe"

This script uses OpenCV DNN SSD face detector and captures 150 images
with guided pose prompts for robust face recognition training.
"""

import sys
import os
import time
import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TOTAL_IMAGES = 150
FACE_CONFIDENCE_THRESHOLD = 0.5
FACE_PADDING = 30
FRAME_SKIP = 2  # Process every 2nd frame

# Pose prompts: (start_index, end_index, instruction)
POSE_PROMPTS = [
    (1, 30, "Look STRAIGHT at camera"),
    (31, 60, "Turn head slightly LEFT"),
    (61, 90, "Turn head slightly RIGHT"),
    (91, 120, "Tilt head UP slightly"),
    (121, 150, "SMILE and show expressions"),
]

# Paths (relative to this script's directory)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
DNN_DIR = os.path.join(SCRIPT_DIR, "models_dnn")
DATASET_DIR = os.path.join(PROJECT_DIR, "dataset")

PROTOTXT_PATH = os.path.join(DNN_DIR, "deploy.prototxt")
CAFFEMODEL_PATH = os.path.join(DNN_DIR, "res10_300x300_ssd_iter_140000.caffemodel")


# ---------------------------------------------------------------------------
# Webcam helper
# ---------------------------------------------------------------------------
def get_webcam():
    """
    Robust webcam opener. Tries multiple camera indexes with DirectShow
    backend first (Windows), then falls back to default backend.
    Returns an opened cv2.VideoCapture or None.
    """
    backends = [
        ("DirectShow", cv2.CAP_DSHOW),
        ("Default", cv2.CAP_ANY),
    ]
    indexes = [0, 1, 2]

    for backend_name, backend in backends:
        for idx in indexes:
            print(f"[INFO] Trying camera index {idx} with {backend_name} backend...")
            cap = cv2.VideoCapture(idx, backend)
            if cap.isOpened():
                # Try reading a test frame to confirm it works
                ret, frame = cap.read()
                if ret and frame is not None and frame.size > 0:
                    print(f"[INFO] Successfully opened camera index {idx} ({backend_name})")
                    return cap
                else:
                    cap.release()
            else:
                cap.release()

    return None


# ---------------------------------------------------------------------------
# Face detection
# ---------------------------------------------------------------------------
def load_face_detector():
    """Load OpenCV DNN SSD face detector model."""
    if not os.path.isfile(PROTOTXT_PATH):
        print(f"[ERROR] Prototxt not found: {PROTOTXT_PATH}")
        sys.exit(1)
    if not os.path.isfile(CAFFEMODEL_PATH):
        print(f"[ERROR] Caffemodel not found: {CAFFEMODEL_PATH}")
        sys.exit(1)

    net = cv2.dnn.readNetFromCaffe(PROTOTXT_PATH, CAFFEMODEL_PATH)
    print("[INFO] Face detection model loaded successfully.")
    return net


def detect_faces(net, frame):
    """
    Detect faces in a frame using OpenCV DNN SSD.
    Returns a list of (startX, startY, endX, endY, confidence) tuples.
    """
    (h, w) = frame.shape[:2]
    blob = cv2.dnn.blobFromImage(
        cv2.resize(frame, (300, 300)), 1.0, (300, 300),
        (104.0, 177.0, 123.0), swapRB=False, crop=False
    )
    net.setInput(blob)
    detections = net.forward()

    faces = []
    for i in range(detections.shape[2]):
        confidence = float(detections[0, 0, i, 2])
        if confidence >= FACE_CONFIDENCE_THRESHOLD:
            box = detections[0, 0, i, 3:7] * np.array([w, h, w, h])
            (startX, startY, endX, endY) = box.astype("int")
            # Clamp to frame boundaries
            startX = max(0, startX)
            startY = max(0, startY)
            endX = min(w, endX)
            endY = min(h, endY)
            faces.append((startX, startY, endX, endY, confidence))

    return faces


# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------
def get_current_prompt(image_count):
    """Return the pose instruction for the current image count."""
    for start, end, prompt in POSE_PROMPTS:
        if start <= image_count <= end:
            return prompt
    return "Hold steady..."


def draw_progress_bar(frame, current, total):
    """Draw a progress bar at the bottom of the frame."""
    h, w = frame.shape[:2]
    bar_height = 25
    bar_y = h - bar_height - 10
    bar_x = 20
    bar_width = w - 40
    progress = current / total

    # Background bar (dark gray)
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_width, bar_y + bar_height),
                  (50, 50, 50), -1)
    # Progress fill (green)
    fill_width = int(bar_width * progress)
    if fill_width > 0:
        cv2.rectangle(frame, (bar_x, bar_y), (bar_x + fill_width, bar_y + bar_height),
                      (0, 200, 0), -1)
    # Border
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_width, bar_y + bar_height),
                  (255, 255, 255), 1)
    # Text
    pct_text = f"{current}/{total} ({int(progress * 100)}%)"
    text_size = cv2.getTextSize(pct_text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)[0]
    text_x = bar_x + (bar_width - text_size[0]) // 2
    text_y = bar_y + (bar_height + text_size[1]) // 2
    cv2.putText(frame, pct_text, (text_x, text_y),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)


def draw_instruction(frame, text):
    """Draw the current pose instruction prominently at the top."""
    h, w = frame.shape[:2]
    # Background banner
    cv2.rectangle(frame, (0, 0), (w, 55), (0, 0, 0), -1)
    # Instruction text (large, yellow)
    text_size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.85, 2)[0]
    text_x = (w - text_size[0]) // 2
    cv2.putText(frame, text, (text_x, 38),
                cv2.FONT_HERSHEY_SIMPLEX, 0.85, (0, 255, 255), 2, cv2.LINE_AA)


def draw_info(frame, student_id, student_name):
    """Draw student info on the frame."""
    info_text = f"ID: {student_id} | Name: {student_name}"
    cv2.putText(frame, info_text, (10, 75),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1, cv2.LINE_AA)


# ---------------------------------------------------------------------------
# Main capture loop
# ---------------------------------------------------------------------------
def main():
    # ---- Parse arguments ----
    if len(sys.argv) < 3:
        print("Usage: python capture_faces.py <student_id> <student_name>")
        print('Example: python capture_faces.py 101 "John Doe"')
        sys.exit(1)

    student_id = sys.argv[1]
    student_name = sys.argv[2]
    folder_name = student_name.strip().lower().replace(" ", "_")

    print(f"[INFO] Student ID   : {student_id}")
    print(f"[INFO] Student Name : {student_name}")
    print(f"[INFO] Folder       : {folder_name}")
    print(f"[INFO] Total images to capture: {TOTAL_IMAGES}")

    # ---- Create output directory ----
    save_dir = os.path.join(DATASET_DIR, folder_name)
    os.makedirs(save_dir, exist_ok=True)
    print(f"[INFO] Saving faces to: {save_dir}")

    # ---- Load face detector ----
    net = load_face_detector()

    # ---- Open webcam ----
    cap = get_webcam()
    if cap is None:
        print("[ERROR] Could not open any webcam. Exiting.")
        sys.exit(1)

    # Set resolution for better quality if supported
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    print("[INFO] Camera opened. Starting capture...")
    print("[INFO] Press 'q' to quit early.\n")

    image_count = 0
    frame_count = 0
    window_name = "Face Capture - Press Q to Quit"

    while image_count < TOTAL_IMAGES:
        ret, frame = cap.read()
        if not ret or frame is None:
            print("[WARNING] Failed to read frame, retrying...")
            time.sleep(0.1)
            continue

        frame_count += 1
        display_frame = frame.copy()

        # Current pose prompt (based on next image to capture)
        current_prompt = get_current_prompt(image_count + 1)

        # ---- Process every 2nd frame ----
        if frame_count % FRAME_SKIP == 0:
            faces = detect_faces(net, frame)

            if faces:
                # Use the face with the highest confidence
                faces.sort(key=lambda f: f[4], reverse=True)
                (startX, startY, endX, endY, confidence) = faces[0]

                # Validate face region size
                face_w = endX - startX
                face_h = endY - startY
                if face_w > 20 and face_h > 20:
                    # ---- Save face crop with padding ----
                    (fh, fw) = frame.shape[:2]
                    pad_startX = max(0, startX - FACE_PADDING)
                    pad_startY = max(0, startY - FACE_PADDING)
                    pad_endX = min(fw, endX + FACE_PADDING)
                    pad_endY = min(fh, endY + FACE_PADDING)

                    face_crop = frame[pad_startY:pad_endY, pad_startX:pad_endX]

                    if face_crop.size > 0:
                        image_count += 1
                        filename = f"{folder_name}_{image_count:04d}.jpg"
                        filepath = os.path.join(save_dir, filename)
                        cv2.imwrite(filepath, face_crop)

                        # Draw green rectangle around detected face
                        cv2.rectangle(display_frame, (startX, startY), (endX, endY),
                                      (0, 255, 0), 2)

                        # Confidence label
                        conf_label = f"{confidence * 100:.1f}%"
                        cv2.putText(display_frame, conf_label, (startX, startY - 8),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1,
                                    cv2.LINE_AA)

        # ---- Draw UI elements ----
        draw_instruction(display_frame, current_prompt)
        draw_info(display_frame, student_id, student_name)
        draw_progress_bar(display_frame, image_count, TOTAL_IMAGES)

        # ---- Show frame ----
        cv2.imshow(window_name, display_frame)

        # ---- Key handling ----
        key = cv2.waitKey(1) & 0xFF
        if key == ord('q') or key == ord('Q'):
            print("\n[INFO] Quit early by user.")
            break

    # ---- Cleanup ----
    cap.release()
    cv2.destroyAllWindows()

    # ---- Summary ----
    print("\n" + "=" * 50)
    print("           CAPTURE SUMMARY")
    print("=" * 50)
    print(f"  Student ID   : {student_id}")
    print(f"  Student Name : {student_name}")
    print(f"  Images Saved : {image_count} / {TOTAL_IMAGES}")
    print(f"  Save Location: {save_dir}")
    if image_count == TOTAL_IMAGES:
        print("  Status       : COMPLETE")
    else:
        print("  Status       : INCOMPLETE (quit early)")
    print("=" * 50)

    if image_count == 0:
        print("\n[WARNING] No images were captured. Check camera and lighting.")
    elif image_count < TOTAL_IMAGES:
        print(f"\n[WARNING] Only {image_count}/{TOTAL_IMAGES} images captured.")
        print("  You may want to run the script again to collect more data.")
    else:
        print("\n[SUCCESS] All images captured successfully!")
        print("  You can now proceed to train the model.")


if __name__ == "__main__":
    main()
