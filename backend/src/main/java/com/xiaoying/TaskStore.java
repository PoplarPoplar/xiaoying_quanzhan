package com.xiaoying;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import java.util.function.Consumer;
import org.springframework.stereotype.Service;
import org.springframework.transaction.*;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class TaskStore {
  final StoreMapper db;
  final ObjectMapper json;
  final TransactionTemplate tx;

  public TaskStore(StoreMapper db, ObjectMapper json, PlatformTransactionManager manager) {
    this.db = db;
    this.json = json;
    tx = new TransactionTemplate(manager);
    tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  Map<String, Object> decode(String payload) {
    if (payload == null) return null;
    try {
      return json.readValue(payload, new TypeReference<LinkedHashMap<String, Object>>() {});
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  String encode(Map<String, Object> task) {
    try {
      return json.writeValueAsString(task);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  Map<String, Object> row(Map<String, Object> task) {
    var row = new HashMap<>(task);
    row.put("payload", encode(task));
    return row;
  }

  void insert(Map<String, Object> task) {
    tx.executeWithoutResult(s -> db.insertTask(row(task)));
  }

  public Map<String, Object> get(String id) {
    var t = decode(db.task(id));
    if (t == null) throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在或无权访问");
    return t;
  }

  Map<String, Object> owned(String id, String user) {
    var t = get(id);
    if (!user.equals(t.get("userId"))) throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在或无权访问");
    return t;
  }

  public boolean mutate(String id, Consumer<Map<String, Object>> change) {
    return Boolean.TRUE.equals(
        tx.execute(
            s -> {
              var t = decode(db.lock(id));
              if (t == null || terminal(t)) return false;
              change.accept(t);
              t.put("version", ((Number) t.get("version")).longValue() + 1);
              db.updateTask(row(t));
              return true;
            }));
  }

  static boolean terminal(Map<String, Object> t) {
    return Set.of("SUCCEEDED", "FAILED").contains(t.get("status"));
  }

  List<Map<String, Object>> history(String user) {
    return db.history(user).stream().map(this::decode).toList();
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> publicView(Map<String, Object> t) {
    var r = new LinkedHashMap<>(t);
    r.keySet().removeAll(Set.of("userId", "assetIds", "simulation", "resultPath"));
    return r;
  }

  @SuppressWarnings("unchecked")
  static List<Map<String, Object>> steps(Map<String, Object> t) {
    return (List<Map<String, Object>>) t.get("steps");
  }
}
