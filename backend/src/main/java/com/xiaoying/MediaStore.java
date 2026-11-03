package com.xiaoying;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import javax.imageio.*;
import javax.imageio.stream.ImageInputStream;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class MediaStore {
  final Path root;
  private final StoreMapper db;
  public static final long MAX = 5 * 1024 * 1024;

  public MediaStore(StoreMapper db, @Value("${app.storage}") String path) throws IOException {
    this.db = db;
    root = Path.of(path).toAbsolutePath().normalize();
    Files.createDirectories(root);
  }

  Path path(String relative) {
    Path p = root.resolve(relative).normalize();
    if (!p.startsWith(root)) throw new ApiError(400, "INVALID_PATH", "无效素材路径");
    return p;
  }

  public Map<String, Object> upload(String user, MultipartFile file) throws IOException {
    if (file.isEmpty()) throw new ApiError(400, "EMPTY_FILE", "请选择图片");
    if (file.getSize() > MAX) throw new ApiError(413, "FILE_TOO_LARGE", "图片不能超过 5MB");
    byte[] bytes = file.getBytes();
    String mime;
    try (ImageInputStream input = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
      var readers = ImageIO.getImageReaders(input);
      if (!readers.hasNext()) throw new ApiError(415, "UNSUPPORTED_TYPE", "只支持真实 PNG / JPEG 图片");
      var reader = readers.next();
      try {
        reader.setInput(input);
        String format = reader.getFormatName().toLowerCase(Locale.ROOT);
        if (!Set.of("png", "jpeg", "jpg").contains(format))
          throw new ApiError(415, "UNSUPPORTED_TYPE", "只支持 PNG / JPEG 图片");
        long pixels = (long) reader.getWidth(0) * reader.getHeight(0);
        if (pixels > 25000000) throw new ApiError(400, "IMAGE_TOO_LARGE", "图片像素不能超过 2500 万");
        if (reader.read(0) == null) throw new ApiError(415, "INVALID_IMAGE", "无法解码图片");
        mime = format.equals("png") ? "image/png" : "image/jpeg";
      } finally {
        reader.dispose();
      }
    } catch (ApiError e) {
      throw e;
    } catch (Exception e) {
      throw new ApiError(415, "INVALID_IMAGE", "图片损坏或无法解码");
    }
    String id = UUID.randomUUID().toString(),
        relative = "asset-" + id + (mime.equals("image/png") ? ".png" : ".jpg");
    Path destination = path(relative);
    Files.write(destination, bytes, StandardOpenOption.CREATE_NEW);
    var row = new HashMap<String, Object>();
    row.put("id", id);
    row.put("userId", user);
    row.put("storagePath", relative);
    row.put("mimeType", mime);
    row.put("sizeBytes", bytes.length);
    try {
      db.asset(row);
    } catch (RuntimeException e) {
      Files.deleteIfExists(destination);
      throw e;
    }
    return Map.of(
        "id",
        id,
        "previewUrl",
        "/api/assets/" + id + "/content",
        "mimeType",
        mime,
        "sizeBytes",
        bytes.length);
  }

  public Map<String, Object> owned(String id, String user) {
    var a = db.assetOwned(id, user);
    if (a == null) throw new ApiError(404, "ASSET_NOT_FOUND", "素材不存在或无权访问");
    if (!Files.isRegularFile(path((String) a.get("storagePath"))))
      throw new ApiError(400, "ASSET_UNAVAILABLE", "素材文件不可用");
    return a;
  }

  public String prepareResult(String task, String template) throws IOException {
    String relative = "result-" + task + ".png";
    try (var in = getClass().getResourceAsStream("/demo-assets/" + template + ".png")) {
      if (in == null) throw new IOException("Missing result fixture");
      Files.copy(in, path(relative), StandardCopyOption.REPLACE_EXISTING);
    }
    return relative;
  }
}
