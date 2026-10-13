"""
PeaceOut (desktop) — hold up a peace sign and fade out of your webcam feed
in ANY app that can pick a virtual camera: Zoom, Discord, Teams, whatever.

Unlike the Chrome extension, this doesn't hook a specific site — it reads
your real webcam, and republishes a virtual camera that any desktop app can
select as its input. One-time setup: install OBS Studio, open it once,
click Start Virtual Camera then Stop Virtual Camera, close OBS. Then run
this script and pick "OBS Virtual Camera" in your call app.

Usage:
    python peaceout.py [--camera N]

Keys (focus the preview window):
    c   capture the empty room (step out of frame, wait ~3s)
    q   quit
    Ctrl/Cmd — no shortcut needed, the peace sign IS the trigger; 'v' is
        a manual backup toggle if the gesture ever misfires
"""

import argparse
import time

import cv2
import mediapipe as mp
import numpy as np
import pyvirtualcam

BG_FRAMES = 12          # frames averaged into the empty-room photo
FADE_MS = 1200           # fade duration, matches the browser extension
HITS_NEEDED = 3           # consecutive positive frames before a gesture counts
MISS_NEEDED = 8           # consecutive negative frames before it re-arms — wants a clear,
                          # deliberate drop, not just the hand relaxing for a moment
COOLDOWN_MS = 3000        # minimum time between fires — comfortably longer than FADE_MS,
                          # so the cooldown alone still blocks a refire even if the hand
                          # drifts back into the pose while watching the fade finish
EXT_T = 1.2               # fingertip/knuckle distance-from-wrist ratio: extended
CURL_T = 1.5              # ...curled — many hands don't fold ring/pinky tight
                          # to the palm for a peace sign; 1.5 still sits clearly
                          # below a fully extended finger (~1.8-2.0) for most hands


def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


class PeaceSignDetector:
    """Same peace-sign gate as the Chrome extension's gesture.js, ported to
    Python: each fingertip's distance from the wrist relative to its own
    knuckle's distance from the wrist, so it holds at any hand size or
    distance from the camera."""

    def __init__(self):
        self.hands = mp.solutions.hands.Hands(
            model_complexity=0,
            max_num_hands=1,
            min_detection_confidence=0.6,
            min_tracking_confidence=0.6,
        )
        self.hit_streak = 0
        self.miss_streak = 0
        self.last_fire = 0.0
        self.armed = True  # must drop the pose once before it can fire again

    def _ratio(self, lm, tip, mcp):
        wrist = lm[0]
        d_tip = np.hypot(lm[tip].x - wrist.x, lm[tip].y - wrist.y)
        d_mcp = np.hypot(lm[mcp].x - wrist.x, lm[mcp].y - wrist.y)
        return d_tip / max(1e-5, d_mcp)

    def _is_peace_sign(self, lm):
        index = self._ratio(lm, 8, 5)
        middle = self._ratio(lm, 12, 9)
        ring = self._ratio(lm, 16, 13)
        pinky = self._ratio(lm, 20, 17)
        return index > EXT_T and middle > EXT_T and ring < CURL_T and pinky < CURL_T, (index, middle, ring, pinky)

    def tick(self, rgb_frame):
        """Returns (fired: bool, debug: str)."""
        now = time.monotonic() * 1000
        result = self.hands.process(rgb_frame)
        if not result.multi_hand_landmarks:
            self.hit_streak = 0
            self.miss_streak += 1
            if self.miss_streak >= MISS_NEEDED:
                self.armed = True
            return False, "no hand in frame"

        lm = result.multi_hand_landmarks[0].landmark
        seen, metrics = self._is_peace_sign(lm)
        cooling = now - self.last_fire < COOLDOWN_MS
        dbg = "hand seen - i%.2f m%.2f r%.2f p%.2f" % metrics

        if not seen:
            self.hit_streak = 0
            # debounced: a single flickered frame shouldn't count as "dropped
            # the pose" — needs a few consecutive misses, same as hits do
            self.miss_streak += 1
            if self.miss_streak >= MISS_NEEDED:
                self.armed = True
            return False, dbg

        self.miss_streak = 0
        self.hit_streak += 1
        if cooling:
            return False, dbg + " - PEACE (cooling down)"
        if not self.armed:
            return False, dbg + " - PEACE (lower your hand to re-arm)"

        dbg += " - PEACE %d/%d" % (min(self.hit_streak, HITS_NEEDED), HITS_NEEDED)
        if self.hit_streak >= HITS_NEEDED:
            self.last_fire = now
            self.hit_streak = 0
            self.armed = False  # won't fire again until you drop the pose
            return True, dbg
        return False, dbg


class FadePipeline:
    """live -> fading-out -> gone -> fading-in -> live, same state machine
    and easing as the Chrome extension's content.js."""

    def __init__(self):
        self.mode = "live"
        self.bg = None
        self.t0 = 0.0

    def trigger(self):
        if self.bg is None:
            return False
        now = time.monotonic() * 1000
        if self.mode == "live":
            self.mode, self.t0 = "fading-out", now
            return True
        if self.mode == "gone":
            self.mode, self.t0 = "fading-in", now
            return True
        return False

    def render(self, live_frame):
        if self.mode == "live" or self.bg is None:
            return live_frame
        if self.mode == "gone":
            return self.bg
        now = time.monotonic() * 1000
        t = min(1.0, (now - self.t0) / FADE_MS)
        e = smoothstep(t)
        fading_out = self.mode == "fading-out"
        cam_alpha = (1 - e) if fading_out else e
        out = cv2.addWeighted(live_frame, cam_alpha, self.bg, 1 - cam_alpha, 0)
        if t >= 1.0:
            self.mode = "live" if fading_out else "gone"
        return out

    def capture_bg(self, cap, w, h):
        acc = np.zeros((h, w, 3), dtype=np.float32)
        got = 0
        for _ in range(BG_FRAMES):
            ok, frame = cap.read()
            if not ok:
                continue
            frame = cv2.resize(frame, (w, h))
            acc += frame.astype(np.float32)
            got += 1
            time.sleep(0.04)
        if got:
            self.bg = (acc / got).astype(np.uint8)
            self.mode = "live"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", type=int, default=0)
    args = ap.parse_args()

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        raise SystemExit(f"Could not open camera {args.camera}. Try --camera 1, --camera 2, ...")
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1280
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 720
    fps = 30

    detector = PeaceSignDetector()
    pipeline = FadePipeline()

    print(f"Camera {args.camera}: {w}x{h}")
    print("Virtual camera starting — pick 'OBS Virtual Camera' in Zoom/Discord/Teams.")
    print("Keys: c = capture empty room, v = manual vanish/return, q = quit")

    with pyvirtualcam.Camera(width=w, height=h, fps=fps) as vcam:
        print(f"Virtual camera: '{vcam.device}'")
        capturing_in = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                continue
            frame = cv2.resize(frame, (w, h))

            if capturing_in > 0:
                remaining = capturing_in - time.monotonic()
                if remaining <= 0:
                    pipeline.capture_bg(cap, w, h)
                    capturing_in = 0
                    print("room captured")
                else:
                    cv2.putText(frame, f"capturing in {int(remaining) + 1}...", (30, 50),
                                cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            rgb.flags.writeable = False
            fired, dbg = detector.tick(rgb)
            if fired:
                pipeline.trigger()

            out = pipeline.render(frame)

            hud = f"mode: {pipeline.mode}  |  {dbg}"
            cv2.putText(out, hud, (10, h - 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
            cv2.imshow("PeaceOut — focus this window, q to quit", out)

            vcam.send(cv2.cvtColor(out, cv2.COLOR_BGR2RGB))
            vcam.sleep_until_next_frame()

            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            elif key == ord("c") and capturing_in == 0:
                capturing_in = time.monotonic() + 3
            elif key == ord("v"):
                pipeline.trigger()

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
