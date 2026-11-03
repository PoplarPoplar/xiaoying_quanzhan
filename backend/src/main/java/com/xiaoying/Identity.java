package com.xiaoying;

import jakarta.servlet.http.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class Identity {
  private final StoreMapper db;
  private final TransactionTemplate tx;
  private final boolean secure;

  public Identity(
      StoreMapper db,
      PlatformTransactionManager manager,
      @Value("${app.secure-cookie}") boolean secure) {
    this.db = db;
    tx = new TransactionTemplate(manager);
    this.secure = secure;
  }

  static String hash(String token) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  public Map<String, Object> find(HttpServletRequest req) {
    if (req.getCookies() != null)
      for (Cookie c : req.getCookies())
        if (c.getName().equals("XY_SESSION"))
          return db.identity(hash(c.getValue()), System.currentTimeMillis());
    return null;
  }

  public String require(HttpServletRequest req) {
    var u = find(req);
    if (u == null) throw new ApiError(401, "SESSION_EXPIRED", "身份已失效，请刷新建立新身份");
    return (String) u.get("id");
  }

  public Map<String, Object> create(HttpServletRequest req, HttpServletResponse res) {
    var existing = find(req);
    if (existing != null) return existing;
    byte[] bytes = new byte[32];
    new SecureRandom().nextBytes(bytes);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes),
        id = UUID.randomUUID().toString(),
        name = "访客 " + id.substring(0, 6);
    tx.executeWithoutResult(
        s -> {
          db.user(id, name);
          db.session(hash(token), id, System.currentTimeMillis() + 30L * 86400000);
        });
    res.addHeader(
        "Set-Cookie",
        ResponseCookie.from("XY_SESSION", token)
            .httpOnly(true)
            .secure(secure)
            .path("/")
            .sameSite("Lax")
            .maxAge(30L * 86400)
            .build()
            .toString());
    return Map.of("id", id, "displayName", name);
  }
}
