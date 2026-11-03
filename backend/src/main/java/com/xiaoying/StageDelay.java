package com.xiaoying;

import org.springframework.stereotype.Component;

/**
 * Isolates elapsed-time simulation so tests can block/release workers without timing thresholds.
 */
@Component
public class StageDelay {
  public void pause(long millis) throws InterruptedException {
    Thread.sleep(millis);
  }
}
