package com.xiaoying;

import jakarta.annotation.PreDestroy;
import java.time.Instant;
import java.util.*;
import org.slf4j.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Service;

@Service
public class TaskEngine {
  public static final List<String> STAGES = List.of("CHECK_ASSETS", "GENERATE", "PACKAGE_RESULT");
  final StageDelay delay;
  final TaskStore tasks;
  final MediaStore media;
  final StoreMapper db;
  final boolean demo;
  final ThreadPoolTaskExecutor executor;

  public TaskEngine(
      StageDelay delay,
      TaskStore tasks,
      MediaStore media,
      StoreMapper db,
      Environment env,
      @Value("${app.queue-capacity}") int capacity) {
    this.delay = delay;
    this.tasks = tasks;
    this.media = media;
    this.db = db;
    demo = env.acceptsProfiles(Profiles.of("demo", "test"));
    executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(1);
    executor.setMaxPoolSize(1);
    executor.setQueueCapacity(capacity);
    executor.setThreadNamePrefix("production-");
    executor.setWaitForTasksToCompleteOnShutdown(true);
    executor.setAwaitTerminationSeconds(10);
    executor.initialize();
  }

  @PreDestroy
  void stop() {
    executor.shutdown();
  }

  @EventListener(ApplicationReadyEvent.class)
  void recover() {
    for (String p : db.interrupted()) {
      var t = tasks.decode(p);
      fail((String) t.get("id"), "SERVICE_RESTARTED", "服务重启，任务已中断，请重新创建");
    }
  }

  public record Simulation(String failAt, Map<String, Integer> delaysMs) {}

  public record Create(String templateId, List<String> assetIds, Simulation simulation) {}

  public Map<String, Object> create(String user, Create request) {
    if (request == null || request.templateId() == null || request.assetIds() == null)
      throw new ApiError(400, "BAD_REQUEST", "缺少模板或素材");
    var template = db.template(request.templateId());
    if (template == null) throw new ApiError(404, "TEMPLATE_NOT_FOUND", "模板不存在");
    int required = ((Number) template.get("required_image_count")).intValue();
    if (request.assetIds().size() != required
        || new HashSet<>(request.assetIds()).size() != required
        || request.assetIds().stream().anyMatch(Objects::isNull))
      throw new ApiError(400, "INVALID_ASSETS", "素材数量不符或存在重复");
    request.assetIds().forEach(id -> media.owned(id, user));
    Simulation sim = request.simulation();
    if (sim != null && !demo) throw new ApiError(400, "DEMO_DISABLED", "当前模式不允许覆盖模拟参数");
    String failAt = sim == null || sim.failAt() == null ? "NONE" : sim.failAt();
    if (!failAt.equals("NONE") && !STAGES.contains(failAt))
      throw new ApiError(400, "INVALID_SIMULATION", "失败阶段不合法");
    var delays = new LinkedHashMap<String, Integer>();
    for (String stage : STAGES) delays.put(stage, stage.equals("GENERATE") ? 3000 : 1000);
    if (sim != null && sim.delaysMs() != null)
      for (var e : sim.delaysMs().entrySet()) {
        if (!STAGES.contains(e.getKey())
            || e.getValue() == null
            || e.getValue() < 0
            || e.getValue() > 30000)
          throw new ApiError(400, "INVALID_SIMULATION", "阶段耗时必须为 0～30000 毫秒");
        delays.put(e.getKey(), e.getValue());
      }
    var t = new LinkedHashMap<String, Object>();
    String id = UUID.randomUUID().toString();
    t.put("id", id);
    t.put("userId", user);
    t.put("templateId", request.templateId());
    t.put("templateTitle", template.get("title"));
    t.put("assetIds", request.assetIds());
    t.put("status", "QUEUED");
    t.put("currentStage", null);
    t.put("failedStage", null);
    t.put("error", null);
    t.put("resultUrl", null);
    t.put("version", 1L);
    t.put("createdAt", Instant.now().toString());
    t.put("startedAt", null);
    t.put("finishedAt", null);
    t.put("simulation", Map.of("failAt", failAt, "delaysMs", delays));
    var steps = new ArrayList<Map<String, Object>>();
    for (String stage : STAGES) {
      var step = new LinkedHashMap<String, Object>();
      step.put("stage", stage);
      step.put("status", "PENDING");
      step.put("startedAt", null);
      step.put("finishedAt", null);
      steps.add(step);
    }
    t.put("steps", steps);
    tasks.insert(
        t); // TransactionTemplate returns only after COMMIT; dispatch never reads an uncommitted
    // task.
    try {
      executor.execute(() -> run(id));
    } catch (org.springframework.core.task.TaskRejectedException e) {
      fail(id, "QUEUE_REJECTED", "任务队列已满，未开始制作");
      return TaskStore.publicView(tasks.get(id));
    }
    return TaskStore.publicView(t);
  }

  @SuppressWarnings("unchecked")
  void run(String id) {
    try {
      var initial = tasks.get(id);
      if (!"QUEUED".equals(initial.get("status"))) return;
      tasks.mutate(
          id,
          t -> {
            t.put("status", "RUNNING");
            t.put("startedAt", Instant.now().toString());
          });
      var sim = (Map<String, Object>) initial.get("simulation");
      var delays = (Map<String, Number>) sim.get("delaysMs");
      for (int index = 0; index < STAGES.size(); index++) {
        int i = index;
        String stage = STAGES.get(i);
        if (!tasks.mutate(
            id,
            t -> {
              t.put("currentStage", stage);
              var step = TaskStore.steps(t).get(i);
              step.put("status", "RUNNING");
              step.put("startedAt", Instant.now().toString());
            })) return;
        delay.pause(delays.get(stage).longValue());
        if (stage.equals(sim.get("failAt"))) throw new IllegalStateException("模拟阶段失败");
        String result = null;
        if (i == 0)
          for (String asset : (List<String>) initial.get("assetIds"))
            media.owned(asset, (String) initial.get("userId"));
        if (i == 1) {
          try (var fixture =
              media
                  .getClass()
                  .getResourceAsStream("/demo-assets/" + initial.get("templateId") + ".png")) {
            if (fixture == null) throw new IllegalStateException("演示素材缺失");
          }
        }
        if (i == 2) result = media.prepareResult(id, (String) initial.get("templateId"));
        String finalResult = result;
        tasks.mutate(
            id,
            t -> {
              var step = TaskStore.steps(t).get(i);
              step.put("status", "SUCCEEDED");
              step.put("finishedAt", Instant.now().toString());
              if (i == 2) {
                t.put("status", "SUCCEEDED");
                t.put("finishedAt", Instant.now().toString());
                t.put("resultPath", finalResult);
                t.put("resultUrl", "/api/tasks/" + id + "/result");
              }
            });
      }
    } catch (Exception e) {
      if (e instanceof InterruptedException) Thread.currentThread().interrupt();
      LoggerFactory.getLogger(TaskEngine.class).error("Task {} failed", id, e);
      fail(id, "STAGE_FAILED", "制作阶段失败（模拟或素材异常），后续步骤已停止");
    }
  }

  void fail(String id, String code, String message) {
    tasks.mutate(
        id,
        t -> {
          t.put("status", "FAILED");
          t.put("failedStage", t.get("currentStage"));
          t.put("error", Map.of("code", code, "message", message));
          t.put("finishedAt", Instant.now().toString());
          for (var step : TaskStore.steps(t))
            if ("RUNNING".equals(step.get("status"))) {
              step.put("status", "FAILED");
              step.put("finishedAt", Instant.now().toString());
            }
        });
  }
}
