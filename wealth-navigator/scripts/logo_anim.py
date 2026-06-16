from manim import *

class WealthOSLogo(Scene):
    def construct(self):
        self.camera.background_color = "#0f172a"

        # W construida con 4 segmentos de línea
        tl  = np.array([-1.5,  1.0, 0])   # top-left
        bli = np.array([-0.75, -1.0, 0])   # bottom-left-inner
        ct  = np.array([ 0.0,  -0.1, 0])   # center-top
        bri = np.array([ 0.75, -1.0, 0])   # bottom-right-inner
        tr  = np.array([ 1.5,  1.0, 0])    # top-right

        stroke_color = WHITE
        stroke_w = 10

        seg1 = Line(tl,  bli, stroke_color=stroke_color, stroke_width=stroke_w)
        seg2 = Line(bli, ct,  stroke_color=stroke_color, stroke_width=stroke_w)
        seg3 = Line(ct,  bri, stroke_color=stroke_color, stroke_width=stroke_w)
        seg4 = Line(bri, tr,  stroke_color=stroke_color, stroke_width=stroke_w)

        w = VGroup(seg1, seg2, seg3, seg4)
        w.move_to(ORIGIN)

        # Dibuja cada segmento en secuencia, fluido y limpio
        self.play(
            AnimationGroup(
                Create(seg1),
                Create(seg2),
                Create(seg3),
                Create(seg4),
                lag_ratio=0.3,
            ),
            run_time=1.6,
        )
        self.wait(0.5)
