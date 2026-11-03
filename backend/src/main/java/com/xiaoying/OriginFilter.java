package com.xiaoying;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class OriginFilter extends OncePerRequestFilter {
  private final String origin;

  public OriginFilter(@Value("${app.origin}") String origin) {
    this.origin = origin;
  }

  protected void doFilterInternal(
      HttpServletRequest req, HttpServletResponse res, FilterChain chain)
      throws ServletException, IOException {
    if (!req.getMethod().equals("GET") && !req.getMethod().equals("HEAD")) {
      String o = req.getHeader("Origin"), site = req.getHeader("Sec-Fetch-Site");
      if ((o != null && !o.equals(origin)) || "cross-site".equals(site)) {
        res.setStatus(403);
        res.setContentType("application/json;charset=UTF-8");
        res.getWriter().write("{\"code\":\"INVALID_ORIGIN\",\"message\":\"请求来源不受信任\"}");
        return;
      }
    }
    chain.doFilter(req, res);
  }
}
