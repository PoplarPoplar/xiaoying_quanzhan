package com.xiaoying;

import jakarta.servlet.http.*;
import java.io.*;
import java.util.*;
import org.springframework.core.io.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api")
public class ApiController {
  final StoreMapper db;
  final Identity identity;
  final MediaStore media;
  final TaskStore tasks;
  final TaskEngine engine;

  public ApiController(
      StoreMapper db, Identity identity, MediaStore media, TaskStore tasks, TaskEngine engine) {
    this.db = db;
    this.identity = identity;
    this.media = media;
    this.tasks = tasks;
    this.engine = engine;
  }

  @GetMapping("/ping")
  public Map<String, String> ping() {
    return Map.of("status", "ok");
  }

  @PostMapping("/session")
  public Map<String, Object> session(HttpServletRequest req, HttpServletResponse res) {
    return identity.create(req, res);
  }

  @GetMapping("/me")
  public Map<String, Object> me(HttpServletRequest req) {
    identity.require(req);
    return identity.find(req);
  }

  @GetMapping("/categories")
  public Object categories() {
    return List.of(
        Map.of("id", "travel", "name", "旅行灵感"), Map.of("id", "portrait", "name", "人像故事"));
  }

  Map<String, Object> templateView(Map<String, Object> t) {
    if (t == null) throw new ApiError(404, "TEMPLATE_NOT_FOUND", "模板不存在");
    return Map.of(
        "id",
        t.get("id"),
        "categoryId",
        t.get("category_id"),
        "title",
        t.get("title"),
        "description",
        t.get("description"),
        "requiredImageCount",
        t.get("required_image_count"),
        "acceptedMimeTypes",
        List.of("image/png", "image/jpeg"),
        "maxFileSizeBytes",
        MediaStore.MAX,
        "coverUrl",
        "/api/templates/" + t.get("id") + "/cover");
  }

  @GetMapping("/templates")
  public Object templates(@RequestParam(required = false) String categoryId) {
    return db.templates().stream()
        .filter(t -> categoryId == null || categoryId.equals(t.get("category_id")))
        .map(this::templateView)
        .toList();
  }

  @GetMapping("/templates/{id}")
  public Object template(@PathVariable String id) {
    return templateView(db.template(id));
  }

  @GetMapping("/templates/{id}/cover")
  public ResponseEntity<Resource> cover(@PathVariable String id) {
    templateView(db.template(id));
    return ResponseEntity.ok()
        .contentType(MediaType.IMAGE_PNG)
        .body(new ClassPathResource("demo-assets/" + id + ".png"));
  }

  @PostMapping("/assets")
  public ResponseEntity<?> upload(
      HttpServletRequest req, @RequestParam String templateId, @RequestPart MultipartFile file)
      throws IOException {
    String user = identity.require(req);
    templateView(db.template(templateId));
    return ResponseEntity.status(201).body(media.upload(user, file));
  }

  @GetMapping("/assets/{id}/content")
  public ResponseEntity<Resource> asset(HttpServletRequest req, @PathVariable String id) {
    var a = media.owned(id, identity.require(req));
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .header("X-Content-Type-Options", "nosniff")
        .contentType(MediaType.parseMediaType((String) a.get("mimeType")))
        .body(new FileSystemResource(media.path((String) a.get("storagePath"))));
  }

  @PostMapping("/tasks")
  public ResponseEntity<?> create(HttpServletRequest req, @RequestBody TaskEngine.Create request) {
    return ResponseEntity.accepted().body(engine.create(identity.require(req), request));
  }

  @GetMapping("/tasks")
  public Object history(HttpServletRequest req, @RequestParam(required = false) String templateId) {
    var list =
        tasks.history(identity.require(req)).stream()
            .filter(t -> templateId == null || templateId.equals(t.get("templateId")))
            .map(TaskStore::publicView)
            .toList();
    var response = new HashMap<String, Object>();
    response.put("items", list);
    response.put("nextCursor", null);
    return response;
  }

  @GetMapping("/tasks/active")
  public Object active(HttpServletRequest req) {
    return tasks.history(identity.require(req)).stream()
        .filter(t -> !TaskStore.terminal(t))
        .map(TaskStore::publicView)
        .toList();
  }

  @GetMapping("/tasks/{id}")
  public Object task(HttpServletRequest req, @PathVariable String id) {
    return TaskStore.publicView(tasks.owned(id, identity.require(req)));
  }

  @GetMapping("/tasks/{id}/result")
  public ResponseEntity<Resource> result(HttpServletRequest req, @PathVariable String id) {
    var t = tasks.owned(id, identity.require(req));
    if (!"SUCCEEDED".equals(t.get("status"))) throw new ApiError(404, "RESULT_NOT_READY", "结果尚不可用");
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noStore())
        .header("X-Content-Type-Options", "nosniff")
        .contentType(MediaType.IMAGE_PNG)
        .body(new FileSystemResource(media.path((String) t.get("resultPath"))));
  }
}
