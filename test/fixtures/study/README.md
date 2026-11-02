# Study file fixtures

Real files for `src/data/study-files.test.ts`, written by the programs people use, so the
PowerPoint and PDF readers meet real output rather than hand-built zips.

| File | Written by |
| --- | --- |
| `lecture.pptx` | python-pptx 1.0 (Office Open XML as PowerPoint writes it), 2 slides, speaker notes on slide 1 |
| `lecture-libreoffice.pptx` | LibreOffice Impress: `lecture.pptx` → `.odp` → `.pptx` (it drops the speaker notes) |
| `lecture-libreoffice.pdf` | LibreOffice: `soffice --headless --convert-to pdf lecture.pptx` |
| `notes.pdf` | reportlab, 2 pages of text |
| `scanned.pdf` | reportlab, a filled rectangle and no text (what a scan reads as) |

To make them again:

```sh
python3 - <<'PY'
from pptx import Presentation
p = Presentation()
s1 = p.slides.add_slide(p.slide_layouts[1]); s1.shapes.title.text = "Beta blockers"
s1.placeholders[1].text_frame.text = "Block β1 and β2 receptors"
s1.placeholders[1].text_frame.add_paragraph().text = "Names end in -olol"
s1.notes_slide.notes_text_frame.text = "Ask about asthma & COPD"
s2 = p.slides.add_slide(p.slide_layouts[1]); s2.shapes.title.text = "Side effects"
s2.placeholders[1].text_frame.text = "Bradycardia, fatigue, cold hands"
p.save("lecture.pptx")
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
c = canvas.Canvas("notes.pdf", pagesize=A4)
c.drawString(72, 760, "Pharmacology week 3"); c.drawString(72, 740, "Beta blockers end in -olol."); c.showPage()
c.drawString(72, 760, "ACE inhibitors end in -pril."); c.drawString(72, 740, "Side effect: dry cough."); c.showPage(); c.save()
c = canvas.Canvas("scanned.pdf", pagesize=A4); c.setFillGray(0.3); c.rect(72, 600, 400, 150, fill=1); c.showPage(); c.save()
PY
soffice --headless --convert-to odp lecture.pptx && mkdir -p lo
soffice --headless --convert-to pptx --outdir lo lecture.odp && mv lo/lecture.pptx lecture-libreoffice.pptx
soffice --headless --convert-to pdf --outdir lo lecture.pptx && mv lo/lecture.pdf lecture-libreoffice.pdf
rm -rf lo lecture.odp
```
