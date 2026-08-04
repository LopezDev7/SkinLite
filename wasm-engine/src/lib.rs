use std::io::Cursor;

use image::imageops::{self, FilterType};
use libtxd::dictionary::TextureDictionary;
use libtxd::encode::{TextureCreateOptions, TextureFormat};
use libtxd::texture::Texture;
use wasm_bindgen::prelude::*;

const TXD_DICTIONARY_CHUNK: u32 = 0x16;
const STRUCT_CHUNK: u32 = 0x01;
const NATIVE_TEXTURE_CHUNK: u32 = 0x15;
const EXTENSION_CHUNK: u32 = 0x03;

#[wasm_bindgen]
pub fn optimize_txd(bytes: &[u8], max_dimension: u32, quality: f32) -> Result<Vec<u8>, JsError> {
    let raw_texture_count = count_pc_texture_chunks(bytes).map_err(|error| JsError::new(&error))?;
    let mut input = Cursor::new(bytes);
    let mut dictionary = TextureDictionary::from_reader(&mut input)
        .map_err(|error| JsError::new(&format!("No pudimos leer el TXD: {error}")))?;

    if dictionary.textures.is_empty() {
        return Err(JsError::new("Este TXD no tiene texturas que podamos optimizar."));
    }
    if raw_texture_count != dictionary.textures.len() {
        return Err(JsError::new("Este TXD trae texturas de una plataforma que todavía no podemos conservar. Por seguridad, no generamos un archivo incompleto."));
    }

    let options_quality = quality.clamp(0.1, 1.0);
    for texture in &mut dictionary.textures {
        if !texture.can_convert() {
            return Err(JsError::new("Una de las texturas usa una compresión que aún no podemos mantener. No cambiamos el archivo."));
        }

        let name = texture.name.clone();
        let mask_name = texture.mask_name.clone();
        let platform = texture.platform;
        let filter_flags = texture.filter_flags;
        let mut image = texture.to_rgba8(0)
            .map_err(|error| JsError::new(&format!("No pudimos leer una textura de tu TXD: {error}")))?;

        if max_dimension > 0 {
            let (width, height) = image.dimensions();
            let longest_side = width.max(height);
            if longest_side > max_dimension {
                let scale = max_dimension as f32 / longest_side as f32;
                let new_width = ((width as f32 * scale).round() as u32).max(1);
                let new_height = ((height as f32 * scale).round() as u32).max(1);
                image = imageops::resize(&image, new_width, new_height, FilterType::Lanczos3);
            }
        }

        let has_transparency = image.pixels().any(|pixel| pixel[3] < 255);
        let format = if has_transparency {
            TextureFormat::Dxt3 { quality: options_quality }
        } else {
            TextureFormat::Dxt1 { quality: options_quality }
        };
        let mut optimized = Texture::from_rgba(
            name,
            image,
            TextureCreateOptions {
                platform,
                filter_flags,
                format,
                mipmaps: true,
                mip_filter: FilterType::Triangle,
            },
        ).map_err(|error| JsError::new(&format!("No pudimos guardar una textura: {error}")))?;
        optimized.mask_name = mask_name;
        *texture = optimized;
    }

    let mut output = Cursor::new(Vec::new());
    dictionary.save_to(&mut output)
        .map_err(|error| JsError::new(&format!("No pudimos guardar el TXD optimizado: {error}")))?;
    let optimized = output.into_inner();
    if optimized.len() >= bytes.len() {
        return Err(JsError::new("Con estos ajustes el TXD no quedó más liviano. Prueba reducir un poco más el tamaño de las texturas."));
    }
    Ok(optimized)
}

fn count_pc_texture_chunks(bytes: &[u8]) -> Result<usize, String> {
    if read_u32(bytes, 0)? != TXD_DICTIONARY_CHUNK {
        return Err("Ese archivo no parece ser un TXD de GTA San Andreas.".to_owned());
    }
    let root_length = read_u32(bytes, 4)? as usize;
    let root_end = 12usize.checked_add(root_length).ok_or("El TXD está dañado.")?;
    if root_end > bytes.len() {
        return Err("El TXD parece estar incompleto.".to_owned());
    }

    let mut position = 12usize;
    let mut texture_count = 0usize;
    let mut found_dictionary_header = false;
    while position < root_end {
        if root_end - position < 12 {
            return Err("El TXD parece estar dañado.".to_owned());
        }
        let chunk_type = read_u32(bytes, position)?;
        let chunk_length = read_u32(bytes, position + 4)? as usize;
        let chunk_end = position.checked_add(12).and_then(|start| start.checked_add(chunk_length))
            .ok_or("El TXD parece estar dañado.")?;
        if chunk_end > root_end {
            return Err("El TXD parece estar incompleto.".to_owned());
        }
        match chunk_type {
            STRUCT_CHUNK if !found_dictionary_header => found_dictionary_header = true,
            NATIVE_TEXTURE_CHUNK => {
                texture_count += 1;
                check_native_texture_chunks(bytes, position + 12, chunk_end)?;
            }
            EXTENSION_CHUNK if chunk_length == 0 => {},
            EXTENSION_CHUNK => return Err("Este TXD incluye datos extra que no podemos conservar todavía. Por seguridad, no generamos un archivo incompleto.".to_owned()),
            _ => return Err("Este TXD trae información que todavía no podemos conservar. Por seguridad, no generamos un archivo incompleto.".to_owned()),
        }
        position = chunk_end;
    }
    if !found_dictionary_header {
        return Err("No encontramos la tabla de texturas del TXD.".to_owned());
    }
    Ok(texture_count)
}

fn check_native_texture_chunks(bytes: &[u8], start: usize, end: usize) -> Result<(), String> {
    let mut position = start;
    let mut found_texture_data = false;
    while position < end {
        if end - position < 12 {
            return Err("El TXD parece estar dañado.".to_owned());
        }
        let chunk_type = read_u32(bytes, position)?;
        let chunk_length = read_u32(bytes, position + 4)? as usize;
        let chunk_end = position.checked_add(12).and_then(|start| start.checked_add(chunk_length))
            .ok_or("El TXD parece estar dañado.")?;
        if chunk_end > end {
            return Err("El TXD parece estar incompleto.".to_owned());
        }
        match chunk_type {
            STRUCT_CHUNK if !found_texture_data => found_texture_data = true,
            EXTENSION_CHUNK if chunk_length == 0 => {},
            EXTENSION_CHUNK => return Err("Una textura trae datos extra que todavía no podemos guardar. No tocamos el archivo.".to_owned()),
            _ => return Err("Este TXD tiene información de textura que aún no podemos conservar. No tocamos el archivo.".to_owned()),
        }
        position = chunk_end;
    }
    if found_texture_data { Ok(()) } else { Err("No encontramos los datos de una textura del TXD.".to_owned()) }
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let data = bytes.get(offset..offset + 4).ok_or("El TXD parece estar incompleto.")?;
    Ok(u32::from_le_bytes([data[0], data[1], data[2], data[3]]))
}
