package com.xiaoying;

import java.util.*;
import org.apache.ibatis.annotations.*;

@Mapper
public interface StoreMapper {
  @Select("SELECT * FROM material_template ORDER BY id")
  List<Map<String, Object>> templates();

  @Select("SELECT * FROM material_template WHERE id=#{id}")
  Map<String, Object> template(String id);

  @Insert("INSERT INTO app_user VALUES(#{id},#{name})")
  void user(@Param("id") String id, @Param("name") String name);

  @Insert("INSERT INTO user_session VALUES(#{hash},#{user},#{expiry})")
  void session(
      @Param("hash") String hash, @Param("user") String user, @Param("expiry") long expiry);

  @Select(
      "SELECT u.id,u.display_name AS displayName FROM app_user u JOIN user_session s ON"
          + " s.user_id=u.id WHERE s.token_hash=#{hash} AND s.expires_at>#{now}")
  Map<String, Object> identity(@Param("hash") String hash, @Param("now") long now);

  @Insert("INSERT INTO asset VALUES(#{id},#{userId},#{storagePath},#{mimeType},#{sizeBytes})")
  void asset(Map<String, Object> a);

  @Select(
      "SELECT id,user_id AS userId,storage_path AS storagePath,mime_type AS mimeType,size_bytes AS"
          + " sizeBytes FROM asset WHERE id=#{id} AND user_id=#{user}")
  Map<String, Object> assetOwned(@Param("id") String id, @Param("user") String user);

  @Insert(
      "INSERT INTO production_task"
          + " VALUES(#{id},#{userId},#{templateId},#{status},#{version},#{payload},#{createdAt})")
  void insertTask(Map<String, Object> row);

  @Select("SELECT payload FROM production_task WHERE id=#{id}")
  String task(String id);

  @Select("SELECT payload FROM production_task WHERE id=#{id} FOR UPDATE")
  String lock(String id);

  @Update(
      "UPDATE production_task SET status=#{status},version=#{version},payload=#{payload} WHERE"
          + " id=#{id}")
  void updateTask(Map<String, Object> row);

  @Select(
      "SELECT payload FROM production_task WHERE user_id=#{user} ORDER BY created_at DESC,id DESC")
  List<String> history(String user);

  @Select("SELECT payload FROM production_task WHERE status IN ('QUEUED','RUNNING')")
  List<String> interrupted();
}
