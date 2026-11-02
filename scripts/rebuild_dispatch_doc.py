from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION_START
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor


BASE_DIR = Path(__file__).resolve().parent.parent
SOURCE_DOC = Path(r"C:\Users\Asus\Downloads\Plantilla_Despacho_DV4_Junior.docx")
MEDIA_DIR = BASE_DIR / "extracted_media"
OUTPUT_DOC = BASE_DIR / "Despacho_DV4_Junior_Presentacion.docx"

ACCENT = RGBColor(22, 76, 118)
ACCENT_DARK = RGBColor(14, 45, 72)
TEXT = RGBColor(38, 38, 38)
MUTED = RGBColor(105, 105, 105)
LIGHT_FILL = "EAF2F8"
SOFT_FILL = "F7FBFE"


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=90, start=110, bottom=90, end=110):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = tc_pr.find(qn("w:tcMar"))
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for side, value in [("top", top), ("start", start), ("bottom", bottom), ("end", end)]:
        elem = tc_mar.find(qn(f"w:{side}"))
        if elem is None:
            elem = OxmlElement(f"w:{side}")
            tc_mar.append(elem)
        elem.set(qn("w:w"), str(value))
        elem.set(qn("w:type"), "dxa")


def set_table_borders(table, color="C7D7E5", size=6):
    tbl = table._tbl
    tbl_pr = tbl.tblPr
    borders = tbl_pr.find(qn("w:tblBorders"))
    if borders is None:
        borders = OxmlElement("w:tblBorders")
        tbl_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        elem = borders.find(qn(f"w:{edge}"))
        if elem is None:
            elem = OxmlElement(f"w:{edge}")
            borders.append(elem)
        elem.set(qn("w:val"), "single")
        elem.set(qn("w:sz"), str(size))
        elem.set(qn("w:color"), color)


def set_paragraph_border(paragraph, color="D5E3EE", space=4, size=6):
    p_pr = paragraph._p.get_or_add_pPr()
    p_bdr = p_pr.find(qn("w:pBdr"))
    if p_bdr is None:
        p_bdr = OxmlElement("w:pBdr")
        p_pr.append(p_bdr)
    bottom = p_bdr.find(qn("w:bottom"))
    if bottom is None:
        bottom = OxmlElement("w:bottom")
        p_bdr.append(bottom)
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), str(size))
    bottom.set(qn("w:space"), str(space))
    bottom.set(qn("w:color"), color)


def add_page_number(paragraph):
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = "PAGE"
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.extend([fld_begin, instr, fld_sep, fld_end])


def configure_page(doc):
    section = doc.sections[0]
    section.top_margin = Inches(0.8)
    section.bottom_margin = Inches(0.7)
    section.left_margin = Inches(0.8)
    section.right_margin = Inches(0.8)
    section.header_distance = Inches(0.35)
    section.footer_distance = Inches(0.35)

    header = section.header.paragraphs[0]
    header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = header.add_run("Despacho de Vuelo Operacional")
    run.font.name = "Segoe UI"
    run.font.size = Pt(8.5)
    run.font.color.rgb = MUTED

    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = footer.add_run("DV4 Junior  |  Página ")
    run.font.name = "Segoe UI"
    run.font.size = Pt(8.5)
    run.font.color.rgb = MUTED
    add_page_number(footer)


def configure_styles(doc):
    normal = doc.styles["Normal"]
    normal.font.name = "Segoe UI"
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = TEXT
    normal.paragraph_format.space_after = Pt(7)
    normal.paragraph_format.line_spacing = 1.15

    h1 = doc.styles["Heading 1"]
    h1.font.name = "Segoe UI Semibold"
    h1.font.size = Pt(22)
    h1.font.color.rgb = ACCENT_DARK
    h1.paragraph_format.space_after = Pt(4)
    h1.paragraph_format.space_before = Pt(0)

    h2 = doc.styles["Heading 2"]
    h2.font.name = "Segoe UI Semibold"
    h2.font.size = Pt(14)
    h2.font.color.rgb = ACCENT_DARK
    h2.paragraph_format.space_before = Pt(14)
    h2.paragraph_format.space_after = Pt(7)

    h3 = doc.styles["Heading 3"]
    h3.font.name = "Segoe UI Semibold"
    h3.font.size = Pt(11)
    h3.font.color.rgb = ACCENT
    h3.paragraph_format.space_before = Pt(10)
    h3.paragraph_format.space_after = Pt(4)


def add_title_page(doc):
    p = doc.add_paragraph(style="Heading 1")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run("DESPACHO DE VUELO OPERACIONAL")
    run.bold = True
    set_paragraph_border(p, color="A9C3D9", size=10, space=10)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for line in [
        "Curso: Despachador de Vuelo",
        "Chequeo DV4",
        "Alumno: Junior Eugenio Pingo Ipanaque",
    ]:
        run = p.add_run(line + "\n")
        run.font.name = "Segoe UI"
        run.font.size = Pt(11.5)
        run.font.color.rgb = TEXT

    meta = [
        ("Ruta", "AQP – LIM"),
        ("Vuelo", "JCD2026"),
        ("Matrícula", "CCCBE"),
        ("Fecha", "14/06/2026"),
        ("ETD", "1000z"),
        ("Instructor", "Martin Martinez"),
    ]

    table = doc.add_table(rows=3, cols=4)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    widths = [Cm(3.0), Cm(4.2), Cm(3.0), Cm(4.2)]
    for row in table.rows:
        for idx, cell in enumerate(row.cells):
            cell.width = widths[idx]
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            set_cell_margins(cell, 90, 120, 90, 120)
    set_table_borders(table, "BFD1E0", 8)
    for i, (label, value) in enumerate(meta):
        row = i // 2
        col = (i % 2) * 2
        left = table.cell(row, col)
        right = table.cell(row, col + 1)
        set_cell_shading(left, LIGHT_FILL)
        lp = left.paragraphs[0]
        lp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        lr = lp.add_run(label)
        lr.font.name = "Segoe UI Semibold"
        lr.font.size = Pt(10)
        lr.font.color.rgb = ACCENT_DARK
        rp = right.paragraphs[0]
        rp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        rr = rp.add_run(value)
        rr.font.name = "Segoe UI"
        rr.font.size = Pt(10.5)
        rr.font.color.rgb = TEXT

    doc.add_paragraph()


def add_section_heading(doc, text):
    p = doc.add_paragraph(style="Heading 2")
    run = p.add_run(text)
    run.bold = True
    return p


def add_subheading(doc, text):
    p = doc.add_paragraph(style="Heading 3")
    p.add_run(text)
    return p


def add_kv_table(doc, rows):
    table = doc.add_table(rows=0, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_borders(table, "D1DEE9", 6)
    for label, value in rows:
        row = table.add_row()
        row.cells[0].width = Cm(5.2)
        row.cells[1].width = Cm(11.3)
        for cell in row.cells:
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            set_cell_margins(cell)
        set_cell_shading(row.cells[0], SOFT_FILL)
        lp = row.cells[0].paragraphs[0]
        lr = lp.add_run(label)
        lr.font.name = "Segoe UI Semibold"
        lr.font.size = Pt(10)
        lr.font.color.rgb = ACCENT_DARK
        rp = row.cells[1].paragraphs[0]
        rr = rp.add_run(value)
        rr.font.name = "Segoe UI"
        rr.font.size = Pt(10.5)
        rr.font.color.rgb = TEXT


def add_preserved_text_block(doc, title, lines):
    add_subheading(doc, title)
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    table.columns[0].width = Cm(16.5)
    set_table_borders(table, "D6E0E8", 6)
    cell = table.cell(0, 0)
    set_cell_shading(cell, "FBFDFF")
    set_cell_margins(cell, 100, 130, 100, 130)
    for idx, line in enumerate(lines):
        p = cell.paragraphs[0] if idx == 0 else cell.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        run = p.add_run(line)
        run.font.name = "Consolas" if line.startswith(("METAR", "TAF", "TX", "BECMG", "TEMPO")) else "Segoe UI"
        run.font.size = Pt(10.3)
        run.font.color.rgb = TEXT


def add_image(doc, image_name, width_inches, caption=None):
    image_path = MEDIA_DIR / image_name
    if caption:
        cap = doc.add_paragraph()
        cap.alignment = WD_ALIGN_PARAGRAPH.LEFT
        run = cap.add_run(caption)
        run.font.name = "Segoe UI Semibold"
        run.font.size = Pt(10)
        run.font.color.rgb = ACCENT
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(str(image_path), width=Inches(width_inches))


def add_image_pair(doc, left_name, right_name, width_inches=3.05, captions=None):
    table = doc.add_table(rows=1, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    for idx, cell in enumerate(table.rows[0].cells):
        cell.width = Cm(8.2)
        cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        set_cell_margins(cell, 60, 60, 60, 60)
        tc_pr = cell._tc.get_or_add_tcPr()
        tc_borders = tc_pr.find(qn("w:tcBorders"))
        if tc_borders is None:
            tc_borders = OxmlElement("w:tcBorders")
            tc_pr.append(tc_borders)
        for edge in ("top", "left", "bottom", "right"):
            elem = tc_borders.find(qn(f"w:{edge}"))
            if elem is None:
                elem = OxmlElement(f"w:{edge}")
                tc_borders.append(elem)
            elem.set(qn("w:val"), "nil")
        if captions:
            cp = cell.paragraphs[0]
            cp.alignment = WD_ALIGN_PARAGRAPH.LEFT
            cr = cp.add_run(captions[idx])
            cr.font.name = "Segoe UI Semibold"
            cr.font.size = Pt(10)
            cr.font.color.rgb = ACCENT
            img_p = cell.add_paragraph()
        else:
            img_p = cell.paragraphs[0]
        img_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        file_name = left_name if idx == 0 else right_name
        img_p.add_run().add_picture(str(MEDIA_DIR / file_name), width=Inches(width_inches))


def add_bullet_list(doc, items):
    for item in items:
        p = doc.add_paragraph(style="Normal")
        p.paragraph_format.left_indent = Cm(0.4)
        p.paragraph_format.first_line_indent = Cm(-0.3)
        run = p.add_run(item)
        run.font.name = "Segoe UI"
        run.font.size = Pt(10.5)


def add_callout(doc, title, body):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    set_table_borders(table, "B8CADD", 8)
    cell = table.cell(0, 0)
    set_cell_shading(cell, LIGHT_FILL)
    set_cell_margins(cell, 110, 130, 110, 130)
    p = cell.paragraphs[0]
    label = p.add_run(f"{title}: ")
    label.font.name = "Segoe UI Semibold"
    label.font.size = Pt(10.5)
    label.font.color.rgb = ACCENT_DARK
    text = p.add_run(body)
    text.font.name = "Segoe UI"
    text.font.size = Pt(10.5)
    text.font.color.rgb = TEXT


def build_doc():
    doc = Document()
    configure_page(doc)
    configure_styles(doc)

    add_title_page(doc)

    add_section_heading(doc, "Información General del Vuelo")
    add_kv_table(
        doc,
        [
            ("Vuelo", "JCD2026"),
            ("Matrícula", "CCCBE"),
            ("Ruta", "AQP - LIM"),
            ("Fecha", "14/06/2026"),
            ("ETD", "1000z"),
            ("Aeropuerto origen", "SPQU (Aeropuerto Internacional Alfredo Rodríguez Ballón)"),
            ("Aeropuerto destino", "SPJC (Aeropuerto Internacional Jorge Chavez)"),
            ("Alterno", "SPSO (Aeropuerto Capitán FAP Renán Elías Olivera)"),
            ("Tipo de aeronave", "A320"),
        ],
    )

    add_section_heading(doc, "3. Meteorología")
    add_preserved_text_block(
        doc,
        "Origen: SPQU",
        [
            "METAR SPQU 121000Z 06014KT CAVOK 11/M16 Q1024 RMK PP000",
            "TAF SPQU 120505Z 1206/1306 02007KT CAVOK",
            "TX22/1218Z TN05/1210Z",
            "BECMG 1216/1219 24010KT",
            "BECMG 1222/1224 02004KT=",
        ],
    )
    add_preserved_text_block(
        doc,
        "Destino: SPJC",
        [
            "METAR SPJC 121000Z 14005KT 9999 FEW013 OVC030 21/18 Q1012 NOSIG RMK PP000",
            "TAF SPJC 120501Z 1206/1306 17005KT 9000 BKN030",
            "TX24/1219Z TN20/1211Z",
            "BECMG 1217/1219 18015KT=",
        ],
    )
    add_preserved_text_block(
        doc,
        "Alterno: SPSO",
        [
            "METAR SPSO 121000Z 36004KT 8000 OVC026 20/18 Q1012 RMK PP000",
            "TAF SPSO 120501Z 1206/1306 15006KT 9999 BKN030",
            "TX25/1219Z TN17/1211Z",
            "TEMPO 1206/1210 2500 BR",
            "BECMG 1216/1218 24015KT",
            "BECMG 1301/1303 18007KT=",
        ],
    )
    add_image(doc, "image1.png", 6.45, "Imagen satelital")
    add_image(doc, "image2.png", 4.7, "Carta significativa")
    add_image_pair(
        doc,
        "image3.png",
        "image4.png",
        3.05,
        captions=["Pronóstico de viento y temperature", "Pronóstico complementario"],
    )

    add_section_heading(doc, "4. NOTAM")
    add_image(doc, "image5.png", 6.45, "Origen")
    add_image(doc, "image6.png", 6.45, "Destino")
    add_image(doc, "image7.png", 6.45, "Alterno")
    add_subheading(doc, "Restricciones importantes")
    add_bullet_list(
        doc,
        [
            "El NOTAM A4004/25 (ASCENT OF PROBE BALLOON OVER AREQUIPA AD. PREVIOUS COOR WITH AREQUIPA TWR AND LIMA ACC IS REQUIRED. COORD: 162415S0713306W RDO: 35NM F)GND G)UNL)",
            "El NOTAM A0531/25 (DUE TO OBST MAKE HAND AMENDMENT ON AIP-PERU AS FOLLOW: PAGE AD2 SPQU 21-ILS RWY 10. IN APROXIMACION DIRECTA CAT I: TO BE READ: OCA/OCH 8620FT/350FT FOR CAT A/B AND 8630FT/360FT FOR CAT C INSTEAD OF OCA/OCH 8520FT/250 FOR CAT A/B AND 8530FT/260FT FOR CAT C)",
            "El NOTAM A2117/26 (SEQUENCED FLG LGT RWY 22 U/S)",
        ],
    )

    add_section_heading(doc, "5. SIGMET")
    add_image(doc, "image8.png", 4.1)
    add_bullet_list(
        doc,
        [
            "- No se identificó turbulencia que afecte la ruta.",
            "-Tampoco se pronostica condiciones severas de formacion de hielo en ruta.",
            "- No se observan áreas de CB significativas que afecten en la operación.",
            "- No se reporta presencia de Ceniza volcánica en la FIR Lima.",
            "- No se presentan otros fenómenos meteorológicos significativos.",
        ],
    )

    add_section_heading(doc, "6. Plan de Vuelo ICAO (ATC)")
    add_image(doc, "image9.png", 5.0)

    add_section_heading(doc, "7. OFP SIMBRIEF")
    add_subheading(doc, "Plan de vuelo")

    add_section_heading(doc, "8. Ruta Navegada")
    add_image(doc, "image10.png", 5.8, "Ruta")
    add_callout(doc, "SID", "")
    add_callout(doc, "SID", "")
    add_callout(doc, "Aproximación prevista", "")

    add_section_heading(doc, "9. Cartas")
    add_callout(doc, "Contenido", "SID origen | STAR destino | APP destino | Cartas del alterno")
    add_subheading(doc, "SID:")
    add_callout(doc, "SID", "")
    add_image(doc, "image11.png", 5.8)
    add_subheading(doc, "STAR and APP:")
    add_image(doc, "image12.png", 5.5)
    add_image(doc, "image13.png", 5.8)
    add_subheading(doc, "APP:")
    add_subheading(doc, "STAR y APP SPSO")
    add_image_pair(doc, "image14.png", "image15.png", 3.0)

    add_section_heading(doc, "10. MEL")
    add_image(doc, "image16.png", 5.9)
    add_callout(
        doc,
        "Descripción",
        "El MEL 21-28-04A permite la operación de la aeronave con una o ambas válvulas de aislamiento del compartimiento de carga trasero (AFT Cargo Isolation Valves) inoperativas en posición cerrada, siempre que se cumplan las condiciones y procedimientos establecidos",
    )
    add_callout(
        doc,
        "Limitaciones",
        "Para el transporte de animales vivos, se debe utilizar la Live Animal Transportation Calculation Tool, durante la preparación de cabina de vuelo, el pulsador AFT ISOL VALVE debe permanecer en posición OFF.",
    )
    add_callout(
        doc,
        "Procedimiento operacional",
        "Antes del vuelo, se verificará que las válvulas de aislamiento del compartimiento de carga trasero estén cerradas y que la indicación de falla funcione correctamente. Además, si se transportan animales vivos, se aplicará el procedimiento específico de cálculo correspondiente y, durante la preparación de cabina, el pulsador AFT ISOL VALVE se mantendrá en posición OFF, conforme a las limitaciones del MEL.",
    )
    add_callout(
        doc,
        "Impacto en el vuelo",
        "El impacto operacional es bajo, ya que la aeronave puede ser despachada de forma segura cumpliendo las condiciones del MEL. La falla no afecta significativamente el desempeño normal del vuelo; sin embargo, requiere seguir las limitaciones establecidas para la operación del compartimiento de carga, especialmente cuando se transportan animales vivos.",
    )

    add_section_heading(doc, "11. NOTOC")
    add_image(doc, "image17.png", 6.45)

    add_section_heading(doc, "12. Carga Comercial")
    add_kv_table(
        doc,
        [
            ("PAX", "120 Pasajeros"),
            ("Equipaje", "2415 Kg ( 105 Pcs)"),
            ("Prioritario", "460 Kg ( 20 Pcs)"),
            ("AVI", "30 Kg ( 1 AVI)"),
            ("Perecibles", "500 Kg (1 Pcs)"),
            ("Pollos BB", "100 Kg (1 Pcs)"),
            ("HUM", "120 Kg (1 Pcs)"),
        ],
    )

    add_section_heading(doc, "13. Resumen Operacional")
    add_callout(
        doc,
        "Condiciones del origen",
        "Arequipa presenta condiciones meteorológicas favorables para la salida, El TAF mantiene condiciones CAVOK durante el periodo, sin fenómenos significativos.",
    )
    add_callout(
        doc,
        "Condiciones del destino",
        "Lima presenta condiciones operables para la llegada, El TAF prevé visibilidad 9000 m, BKN030 y aumento de viento a 180°/15 kt durante la tarde.",
    )
    add_callout(
        doc,
        "Condiciones del alterno",
        "Pisco se encuentra operativo, sobre los minimos operacionales, 700 ft de techo y 2400m de visibilidad.",
    )
    add_callout(
        doc,
        "Riesgos operacionales",
        "No se observan condiciones severas en origen, destino ni alterno",
    )
    add_callout(doc, "Decisión", "[X] GO    [ ] NO GO")
    add_callout(
        doc,
        "Justificación",
        "Las condiciones meteorológicas permiten realizar el vuelo Arequipa – Lima con alterno Pisco. No se identifican fenómenos significativos que impidan la operación, manteniéndose el vuelo dentro de condiciones operacionales aceptables.",
    )

    doc.save(OUTPUT_DOC)


if __name__ == "__main__":
    build_doc()
