// Surgical run mapping adapted from GenOffice's docx-engine/text-patch.ts
// (2490e20db8a9e89feb95a6914211c9aad3b34a2b), Apache-2.0.
// Copyright 2026 Mainfunc, Inc. Source: https://github.com/genspark-ai/genoffice
// License: https://www.apache.org/licenses/LICENSE-2.0
// Rust adaptation uses the installed quick-xml reader for exact tag boundaries
// and byte offsets, and compares Unicode scalars rather than UTF-16 units.
use quick_xml::{events::Event, Reader};

#[derive(Clone, Copy)]
struct ElementSlice {
    start: usize,
    end: usize,
    body_start: usize,
    body_end: usize,
}

fn element_slices(xml: &str, name: &[u8]) -> Result<Vec<ElementSlice>, String> {
    let mut reader = Reader::from_str(xml);
    let mut slices = Vec::new();
    let mut depth = 0usize;
    let mut start = 0usize;
    let mut body_start = 0usize;
    loop {
        let before = reader.buffer_position() as usize;
        let event = reader
            .read_event()
            .map_err(|error| format!("Malformed Word XML: {error}"))?;
        let after = reader.buffer_position() as usize;
        match event {
            Event::Start(element) if element.name().as_ref() == name => {
                if depth == 0 {
                    start = before;
                    body_start = after;
                }
                depth += 1;
            }
            Event::Empty(element) if element.name().as_ref() == name && depth == 0 => {
                slices.push(ElementSlice {
                    start: before,
                    end: after,
                    body_start: after,
                    body_end: after,
                });
            }
            Event::End(element) if element.name().as_ref() == name => {
                depth = depth
                    .checked_sub(1)
                    .ok_or_else(|| "Unmatched Word closing element".to_string())?;
                if depth == 0 {
                    slices.push(ElementSlice {
                        start,
                        end: after,
                        body_start,
                        body_end: before,
                    });
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if depth != 0 {
        return Err("Unclosed Word element".to_string());
    }
    Ok(slices)
}

fn paragraph_text(xml: &str) -> Result<String, String> {
    let mut text = String::new();
    for node in element_slices(xml, b"w:t")? {
        let decoded = quick_xml::escape::unescape(&xml[node.body_start..node.body_end])
            .map_err(|error| format!("Malformed Word text: {error}"))?;
        text.push_str(&decoded);
    }
    Ok(text)
}

pub(super) fn read_word_text(xml: &str) -> Result<String, String> {
    element_slices(xml, b"w:p")?
        .into_iter()
        .map(|paragraph| paragraph_text(&xml[paragraph.start..paragraph.end]))
        .collect::<Result<Vec<_>, _>>()
        .map(|paragraphs| paragraphs.join("\n"))
}

fn patch_paragraph(xml: &str, replacement: &str) -> Result<String, String> {
    let slices = element_slices(xml, b"w:t")?;
    let old = paragraph_text(xml)?;
    if old == replacement {
        return Ok(xml.to_string());
    }
    if slices.is_empty() {
        let run = format!(
            "<w:r><w:t xml:space=\"preserve\">{}</w:t></w:r>",
            quick_xml::escape::escape(replacement)
        );
        return if let Some(opening) = xml.strip_suffix("/>") {
            Ok(format!("{opening}>{run}</w:p>"))
        } else {
            let body = xml
                .strip_suffix("</w:p>")
                .ok_or_else(|| "Malformed Word paragraph".to_string())?;
            Ok(format!("{body}{run}</w:p>"))
        };
    }
    let old_chars = old.chars().collect::<Vec<_>>();
    let new_chars = replacement.chars().collect::<Vec<_>>();
    let mut prefix = old_chars
        .iter()
        .zip(&new_chars)
        .take_while(|(a, b)| a == b)
        .count();
    let mut suffix = old_chars[prefix..]
        .iter()
        .rev()
        .zip(new_chars[prefix..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    // Whitespace/repeated characters can make a pure insertion ambiguous.
    // Prefer an equivalent run boundary over inserting into an otherwise
    // unchanged run (which may belong to a hyperlink or a different style).
    if prefix == old_chars.len() - suffix {
        let full_suffix = old_chars
            .iter()
            .rev()
            .zip(new_chars.iter().rev())
            .take_while(|(a, b)| a == b)
            .count();
        let earliest = old_chars.len() - full_suffix;
        let mut boundary = 0usize;
        let mut preferred = None;
        for node in &slices {
            if boundary >= earliest && boundary < prefix {
                preferred = Some(boundary);
            }
            boundary += quick_xml::escape::unescape(&xml[node.body_start..node.body_end])
                .map_err(|error| format!("Malformed Word text: {error}"))?
                .chars()
                .count();
        }
        if let Some(boundary) = preferred {
            suffix += prefix - boundary;
            prefix = boundary;
        }
    }
    let change_end = old_chars.len() - suffix;
    let inserted = new_chars[prefix..new_chars.len() - suffix]
        .iter()
        .collect::<String>();
    let mut offset = 0usize;
    let mut anchor = false;
    let mut patches = Vec::new();
    for node in slices {
        let text = quick_xml::escape::unescape(&xml[node.body_start..node.body_end])
            .map_err(|error| format!("Malformed Word text: {error}"))?;
        let chars = text.chars().collect::<Vec<_>>();
        let end = offset + chars.len();
        let touches = if prefix == change_end {
            !anchor && offset <= prefix && prefix <= end
        } else {
            offset < change_end && end > prefix
        };
        if touches {
            let head = chars[..prefix.saturating_sub(offset).min(chars.len())]
                .iter()
                .collect::<String>();
            let tail = chars[change_end.saturating_sub(offset).min(chars.len())..]
                .iter()
                .collect::<String>();
            let middle = if anchor { "" } else { &inserted };
            let encoded = quick_xml::escape::escape(&format!("{head}{middle}{tail}")).into_owned();
            patches.push((node, format!("<w:t xml:space=\"preserve\">{encoded}</w:t>")));
            anchor = true;
        }
        offset = end;
    }
    if !anchor {
        return Err("Word text edit has no valid run anchor".to_string());
    }
    let mut output = xml.to_string();
    for (node, patch) in patches.into_iter().rev() {
        output.replace_range(node.start..node.end, &patch);
    }
    if paragraph_text(&output)? != replacement {
        return Err("Word text edit did not preserve its requested content".to_string());
    }
    Ok(output)
}

pub(super) fn patch_word_text(xml: &str, content: &str) -> Result<String, String> {
    if content.chars().any(|character| {
        !matches!(character as u32, 0x9 | 0xa | 0xd | 0x20..=0xd7ff | 0xe000..=0xfffd | 0x10000..=0x10ffff)
    }) {
        return Err("Word text contains a character that XML cannot represent".to_string());
    }
    let paragraphs = element_slices(xml, b"w:p")?;
    let replacements = if content.is_empty() {
        vec![""; paragraphs.len()]
    } else {
        content
            .split('\n')
            .map(|line| line.trim_end_matches('\r'))
            .collect::<Vec<_>>()
    };
    if paragraphs.is_empty() && content.is_empty() {
        return Ok(xml.to_string());
    }
    if replacements.len() != paragraphs.len() {
        return Err(format!(
            "Document structure changed: expected {} paragraph lines, received {}. Edit paragraph text without adding or removing lines.",
            paragraphs.len(), replacements.len()
        ));
    }
    let mut output = xml.to_string();
    for (paragraph, replacement) in paragraphs.into_iter().zip(replacements).rev() {
        let patch = patch_paragraph(&xml[paragraph.start..paragraph.end], replacement)?;
        output.replace_range(paragraph.start..paragraph.end, &patch);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RICH: &str = "<w:p w14:paraId=\"A\"><w:r><w:t>Start </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold😀</w:t></w:r><w:hyperlink r:id=\"link\"><w:r><w:t> end</w:t></w:r></w:hyperlink></w:p>";

    #[test]
    fn docx_unchanged_text_keeps_every_original_run_byte() {
        assert_eq!(patch_word_text(RICH, "Start bold😀 end").unwrap(), RICH);
    }

    #[test]
    fn docx_local_edit_preserves_other_runs_and_hyperlinks() {
        let edited = patch_word_text(RICH, "Start bold😁 & <ok> end").unwrap();
        assert!(edited.contains("<w:r><w:t>Start </w:t></w:r>"));
        assert!(edited.contains("<w:rPr><w:b/></w:rPr>"));
        assert!(edited.contains("<w:hyperlink r:id=\"link\"><w:r><w:t> end</w:t></w:r></w:hyperlink>"));
        assert_eq!(read_word_text(&edited).unwrap(), "Start bold😁 & <ok> end");
    }

    #[test]
    fn docx_cross_run_deletion_keeps_retained_suffix_in_its_own_style() {
        let edited = patch_word_text(RICH, "Staend").unwrap();
        assert!(edited.contains("<w:t xml:space=\"preserve\">Sta</w:t>"));
        assert!(edited.contains("<w:rPr><w:b/></w:rPr>"));
        assert!(edited.contains("<w:hyperlink r:id=\"link\"><w:r><w:t xml:space=\"preserve\">end</w:t>"));
        assert_eq!(read_word_text(&edited).unwrap(), "Staend");
    }

    #[test]
    fn docx_ambiguous_insertion_keeps_the_following_hyperlink_unchanged() {
        let xml = "<w:p><w:r><w:t>plain </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:hyperlink r:id=\"link\"><w:r><w:t> suffix</w:t></w:r></w:hyperlink></w:p>";
        for text in ["plain bold changed suffix", "plain bold 中文😀 suffix", "plain bold  suffix"] {
            let edited = patch_word_text(xml, text).unwrap();
            assert!(edited.contains("<w:hyperlink r:id=\"link\"><w:r><w:t> suffix</w:t></w:r></w:hyperlink>"));
            assert!(edited.contains("<w:rPr><w:b/></w:rPr>"));
            assert_eq!(read_word_text(&edited).unwrap(), text);
        }
        let inside = patch_word_text(xml, "plain bold suf-added-fix").unwrap();
        assert!(inside.contains("<w:rPr><w:b/></w:rPr><w:t>bold</w:t>"));
        assert_eq!(read_word_text(&inside).unwrap(), "plain bold suf-added-fix");
    }

    #[test]
    fn docx_blank_paragraphs_whitespace_entities_and_tables_round_trip() {
        let xml = "<w:body><w:p/><w:p><w:pPr><w:tabs><w:tab w:pos=\"12\"/></w:tabs></w:pPr><w:r><w:t xml:space=\"preserve\"> A &amp;lt; &#x1F600; </w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/></w:body>";
        let text = read_word_text(xml).unwrap();
        assert_eq!(text, "\n A &lt; 😀 \ncell\n");
        assert_eq!(patch_word_text(xml, &text).unwrap(), xml);
        let edited = patch_word_text(xml, "first\n A &lt; 😀 \ncell\nlast").unwrap();
        assert_eq!(read_word_text(&edited).unwrap(), "first\n A &lt; 😀 \ncell\nlast");
        assert!(edited.contains("<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t>"));
    }

    #[test]
    fn docx_nested_textbox_paragraphs_do_not_truncate_the_outer_slice() {
        let xml = "<w:p><w:r><w:t>outer</w:t><w:drawing><w:txbxContent><w:p><w:r><w:t>inner</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r></w:p>";
        assert_eq!(read_word_text(xml).unwrap(), "outerinner");
        assert_eq!(patch_word_text(xml, "outerinner").unwrap(), xml);
        let edited = patch_word_text(xml, "outerchanged").unwrap();
        assert_eq!(read_word_text(&edited).unwrap(), "outerchanged");
        assert!(edited.contains("<w:txbxContent><w:p>"));
    }

    #[test]
    fn docx_malformed_xml_and_paragraph_count_changes_fail_before_writing() {
        assert!(patch_word_text("<w:p><w:r><w:t>broken", "edited").is_err());
        assert!(patch_word_text(RICH, "one\ntwo").is_err());
        assert!(patch_word_text(RICH, "").is_ok());
        assert!(patch_word_text(RICH, "invalid\0text").is_err());
        let empty = patch_word_text(&format!("{RICH}{RICH}"), "").unwrap();
        assert_eq!(read_word_text(&empty).unwrap(), "\n");
    }
}
