package com.xiaoying;

import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {"app.queue-capacity=1", "app.storage=./target/test-media"})
@ActiveProfiles("test")
@AutoConfigureMockMvc
class ProductionTest {
  @Autowired TaskEngine engine;
  @Autowired TaskStore tasks;
  @Autowired StoreMapper db;
  @Autowired MediaStore media;
  @Autowired MockMvc mvc;
  @MockitoBean StageDelay delay;

  @BeforeEach
  void resetDelay() throws Exception {
    await()
        .atMost(Duration.ofSeconds(10))
        .until(() -> engine.executor.getActiveCount() == 0 && engine.executor.getQueueSize() == 0);
    reset(delay);
  }

  String user() {
    String id = UUID.randomUUID().toString();
    db.user(id, "test");
    return id;
  }

  String asset(String user) throws Exception {
    byte[] bytes = getClass().getResourceAsStream("/demo-assets/postcard.png").readAllBytes();
    return (String)
        media
            .upload(user, new MockMultipartFile("file", "image.png", "image/png", bytes))
            .get("id");
  }

  TaskEngine.Create request(String asset, String failure) {
    return new TaskEngine.Create(
        "postcard",
        List.of(asset),
        new TaskEngine.Simulation(
            failure, Map.of("CHECK_ASSETS", 0, "GENERATE", 0, "PACKAGE_RESULT", 0)));
  }

  Map<String, Object> finish(String id) {
    await().atMost(Duration.ofSeconds(10)).until(() -> TaskStore.terminal(tasks.get(id)));
    return tasks.get(id);
  }

  @Test
  void successPersistsOrderedStagesAndReadableResultAndTerminalIsStable() throws Exception {
    String u = user(), a = asset(u);
    List<String> observed = new CopyOnWriteArrayList<>();
    doAnswer(
            call -> {
              var active = db.interrupted();
              assertThat(active).hasSize(1);
              var t = tasks.decode(active.getFirst());
              observed.add((String) t.get("currentStage"));
              return null;
            })
        .when(delay)
        .pause(anyLong());
    var accepted = engine.create(u, request(a, "NONE"));
    var done = finish((String) accepted.get("id"));
    assertThat(done.get("status")).isEqualTo("SUCCEEDED");
    assertThat(observed).containsExactlyElementsOf(TaskEngine.STAGES);
    assertThat(TaskStore.steps(done))
        .allSatisfy(step -> assertThat(step.get("status")).isEqualTo("SUCCEEDED"));
    assertThat(java.nio.file.Files.size(media.path((String) done.get("resultPath")))).isPositive();
    Object version = done.get("version");
    for (int i = 0; i < 5; i++)
      assertThat(tasks.owned((String) done.get("id"), u).get("version")).isEqualTo(version);
    assertThat(tasks.mutate((String) done.get("id"), t -> t.put("status", "RUNNING"))).isFalse();
  }

  @ParameterizedTest
  @ValueSource(strings = {"CHECK_ASSETS", "GENERATE", "PACKAGE_RESULT"})
  void failureStopsAllFollowingStages(String stage) throws Exception {
    String u = user(), a = asset(u);
    var accepted = engine.create(u, request(a, stage));
    var done = finish((String) accepted.get("id"));
    assertThat(done.get("status")).isEqualTo("FAILED");
    assertThat(done.get("failedStage")).isEqualTo(stage);
    assertThat(done.get("finishedAt")).isNotNull();
    int failed = TaskEngine.STAGES.indexOf(stage);
    for (int i = 0; i < 3; i++)
      assertThat(TaskStore.steps(done).get(i).get("status"))
          .isEqualTo(i < failed ? "SUCCEEDED" : i == failed ? "FAILED" : "PENDING");
    verify(delay, times(failed + 1)).pause(anyLong());
  }

  @Test
  void acceptedWhileWorkerBlockedAndQueueRejectionPersistsWithoutCallerRuns() throws Exception {
    String u = user(), a = asset(u);
    CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
    doAnswer(
            call -> {
              entered.countDown();
              if (!release.await(10, TimeUnit.SECONDS))
                throw new AssertionError("test release missing");
              return null;
            })
        .when(delay)
        .pause(anyLong());
    try {
      String token = "test-token-" + u;
      db.session(Identity.hash(token), u, System.currentTimeMillis() + 60000);
      var response =
          mvc.perform(
                  post("/api/tasks")
                      .cookie(new jakarta.servlet.http.Cookie("XY_SESSION", token))
                      .contentType("application/json")
                      .content(tasks.json.writeValueAsString(request(a, "NONE"))))
              .andExpect(status().isAccepted())
              .andReturn();
      var one = tasks.decode(response.getResponse().getContentAsString());
      assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
      assertThat(tasks.get((String) one.get("id")).get("status")).isEqualTo("RUNNING");
      var two = engine.create(u, request(a, "NONE"));
      assertThat(two.get("status")).isEqualTo("QUEUED");
      var three = engine.create(u, request(a, "NONE"));
      assertThat(three.get("status")).isEqualTo("FAILED");
      assertThat(((Map<?, ?>) three.get("error")).get("code")).isEqualTo("QUEUE_REJECTED");
      assertThat(TaskStore.steps(tasks.get((String) three.get("id"))))
          .allSatisfy(step -> assertThat(step.get("status")).isEqualTo("PENDING"));
    } finally {
      release.countDown();
    }
  }

  @Test
  void rejectsForeignAssetsInvalidImagesAndInvalidSubmission() throws Exception {
    String u = user(), other = user(), a = asset(u);
    assertThatThrownBy(() -> engine.create(other, request(a, "NONE")))
        .isInstanceOfSatisfying(ApiError.class, e -> assertThat(e.status).isEqualTo(404));
    assertThatThrownBy(
            () -> engine.create(u, new TaskEngine.Create("postcard", List.of(a, a), null)))
        .isInstanceOf(ApiError.class);
    assertThatThrownBy(
            () ->
                media.upload(
                    u,
                    new MockMultipartFile("file", "fake.png", "image/png", "not image".getBytes())))
        .isInstanceOfSatisfying(ApiError.class, e -> assertThat(e.status).isEqualTo(415));
    var t = engine.create(u, request(a, "NONE"));
    finish((String) t.get("id"));
    assertThatThrownBy(() -> tasks.owned((String) t.get("id"), other))
        .isInstanceOfSatisfying(ApiError.class, e -> assertThat(e.status).isEqualTo(404));
  }

  @Test
  void sessionCookieAndOriginAndAuthentication() throws Exception {
    mvc.perform(get("/api/me")).andExpect(status().isUnauthorized());
    mvc.perform(post("/api/session").header("Origin", "https://evil.example"))
        .andExpect(status().isForbidden());
    var result =
        mvc.perform(post("/api/session").header("Origin", "http://localhost:3000"))
            .andExpect(status().isOk())
            .andReturn();
    String cookie = result.getResponse().getHeader("Set-Cookie");
    assertThat(cookie).contains("HttpOnly", "SameSite=Lax", "Path=/");
    String token = cookie.split(";", 2)[0].split("=", 2)[1];
    mvc.perform(get("/api/me").cookie(new jakarta.servlet.http.Cookie("XY_SESSION", token)))
        .andExpect(status().isOk());
  }

  @Test
  void restartCleanupMarksInflightFailedWithoutExecutingThem() throws Exception {
    String u = user(), a = asset(u);
    CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
    doAnswer(
            call -> {
              entered.countDown();
              release.await(10, TimeUnit.SECONDS);
              return null;
            })
        .when(delay)
        .pause(anyLong());
    try {
      var first = engine.create(u, request(a, "NONE"));
      assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
      engine.recover();
      var failed = tasks.get((String) first.get("id"));
      assertThat(failed.get("status")).isEqualTo("FAILED");
      assertThat(((Map<?, ?>) failed.get("error")).get("code")).isEqualTo("SERVICE_RESTARTED");
    } finally {
      release.countDown();
    }
  }
}
