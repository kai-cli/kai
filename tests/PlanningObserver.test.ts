/**
 * tests/PlanningObserver.test.ts - Tests for Planning Observer
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { PlanningObserver } from "../PAI/Tools/algorithm/observer";

describe("PlanningObserver", () => {
  let observer: PlanningObserver;

  beforeEach(() => {
    observer = new PlanningObserver();
  });

  test("aligned outcome (expected≈actual) → low divergence, no replan", () => {
    observer.setExpectation("observe", "We will analyze the codebase structure and identify key files");
    const actual = "Analyzed the codebase structure. Identified key files in src/ directory";

    const result = observer.evaluatePhase("observe", actual);

    expect(result.score).toBeLessThan(0.3);
    expect(result.shouldReplan).toBe(false);
  });

  test("error in actual but not expected → high divergence", () => {
    observer.setExpectation("act", "Implementation will complete successfully with all tests passing");
    const actual = "Implementation failed with unexpected error: module not found. Cannot proceed.";

    const result = observer.evaluatePhase("act", actual);

    // Error signals factor should be 1.0 with weight 0.4
    const errorFactor = result.factors.find(f => f.name === "error_signals");
    expect(errorFactor?.score).toBe(1.0);
    expect(result.score).toBeGreaterThanOrEqual(0.4);
    expect(result.shouldReplan).toBe(true);
  });

  test("length divergence (very short actual vs long expected) → moderate divergence", () => {
    const longExpected = "We expect to see a detailed analysis of the system architecture, including database schemas, API endpoints, authentication flows, error handling patterns, and integration points with external services. This should cover at least 5-10 major components.";
    const shortActual = "Found one file.";

    observer.setExpectation("observe", longExpected);
    const result = observer.evaluatePhase("observe", shortActual);

    // Length factor should be high (ratio < 0.3)
    const lengthFactor = result.factors.find(f => f.name === "length_divergence");
    expect(lengthFactor?.score).toBe(1.0);
    expect(result.score).toBeGreaterThan(0.0);
  });

  test("topic drift (expected keywords missing) → moderate divergence", () => {
    observer.setExpectation("orient", "We need to understand database migrations, authentication middleware, and API versioning strategy");
    const actual = "Looking at the frontend components and styling framework instead";

    const result = observer.evaluatePhase("orient", actual);

    // Topic drift should be high (none of the key terms match)
    const topicFactor = result.factors.find(f => f.name === "topic_drift");
    expect(topicFactor).toBeDefined();
    expect(topicFactor!.score).toBeGreaterThan(0.5);
  });

  test("discovery signals ('turns out', 'actually') → elevated divergence", () => {
    observer.setExpectation("decide", "The issue is in the frontend validation logic");
    const actual = "Actually, turns out the issue is in the backend API, contrary to initial assumption";

    const result = observer.evaluatePhase("decide", actual);

    // Discovery signals should be detected
    const discoveryFactor = result.factors.find(f => f.name === "new_discoveries");
    expect(discoveryFactor).toBeDefined();
    expect(discoveryFactor!.score).toBeGreaterThan(0.0);
  });

  test("divergence > 0.3 triggers replan suggestion", () => {
    // Create high divergence scenario
    observer.setExpectation("orient", "Simple configuration change needed");
    const actual = "Error: wrong assumption. This requires complete architecture redesign. Cannot proceed with original plan.";

    const result = observer.evaluatePhase("orient", actual);

    expect(result.score).toBeGreaterThan(0.3);
    expect(result.shouldReplan).toBe(true);
    expect(result.reason).toContain("exceeds threshold");
  });

  test("maxReplans honored (3rd replan attempt → no replan)", () => {
    const config = { maxReplans: 2 };
    observer = new PlanningObserver(config);

    // Trigger first replan
    observer.setExpectation("observe", "Expected outcome 1");
    let result = observer.evaluatePhase("observe", "Error: failed completely");
    expect(result.shouldReplan).toBe(true);

    // Trigger second replan
    observer.setExpectation("orient", "Expected outcome 2");
    result = observer.evaluatePhase("orient", "Error: failed again");
    expect(result.shouldReplan).toBe(true);

    // Third attempt should NOT trigger replan (maxReplans reached)
    observer.setExpectation("decide", "Expected outcome 3");
    result = observer.evaluatePhase("decide", "Error: failed yet again");
    expect(result.shouldReplan).toBe(false);
    expect(observer.getReplanCount()).toBe(2);
  });

  test("reset clears history and replan count", () => {
    observer.setExpectation("observe", "Test expectation");
    observer.evaluatePhase("observe", "Error: failed");

    expect(observer.getHistory().length).toBeGreaterThan(0);
    expect(observer.getReplanCount()).toBeGreaterThan(0);

    observer.reset();

    expect(observer.getHistory().length).toBe(0);
    expect(observer.getReplanCount()).toBe(0);
  });

  test("getHistory returns all phase evaluations in order", () => {
    observer.setExpectation("observe", "Observation expected");
    observer.evaluatePhase("observe", "Observation actual");

    observer.setExpectation("orient", "Orientation expected");
    observer.evaluatePhase("orient", "Orientation actual");

    observer.setExpectation("decide", "Decision expected");
    observer.evaluatePhase("decide", "Decision actual");

    const history = observer.getHistory();

    expect(history.length).toBe(3);
    expect(history[0].phase).toBe("observe");
    expect(history[1].phase).toBe("orient");
    expect(history[2].phase).toBe("decide");
    expect(history[0].timestamp).toBeDefined();
  });

  test("disabled replanning (enableReplanning=false) never triggers", () => {
    const config = { enableReplanning: false };
    observer = new PlanningObserver(config);

    observer.setExpectation("act", "Expected success");
    const actual = "Error: complete failure with unexpected wrong assumption";

    const result = observer.evaluatePhase("act", actual);

    // Even with high divergence, should not replan when disabled
    expect(result.score).toBeGreaterThan(0.3);
    expect(result.shouldReplan).toBe(false);
  });

  test("getReplanDecision returns null when no divergence", () => {
    observer.setExpectation("observe", "Normal observation");
    observer.evaluatePhase("observe", "Normal observation completed");

    const decision = observer.getReplanDecision(["orient", "decide", "act", "verify"]);

    expect(decision).toBeNull();
  });

  test("getReplanDecision returns decision when divergence high", () => {
    observer.setExpectation("observe", "Expected outcome");
    observer.evaluatePhase("observe", "Error: failed completely. Wrong assumption detected.");

    const remainingPhases = ["orient", "decide", "act", "verify"];
    const decision = observer.getReplanDecision(remainingPhases);

    expect(decision).toBeDefined();
    expect(decision?.trigger).toBe("observe");
    expect(decision?.divergenceScore).toBeGreaterThan(0.3);
    expect(decision?.originalPlan).toEqual(remainingPhases);
    expect(decision?.revisedPlan).toBeDefined();
    expect(decision?.reason).toBeDefined();
  });

  test("revised plan includes re-observation for early phase divergence", () => {
    observer.setExpectation("observe", "Expected to find X");
    observer.evaluatePhase("observe", "Error: completely wrong. Actually found Y instead.");

    const remainingPhases = ["orient", "decide", "act", "verify"];
    const decision = observer.getReplanDecision(remainingPhases);

    expect(decision?.revisedPlan).toContain("observe");
    expect(decision?.revisedPlan).toContain("orient");
  });

  test("revised plan goes back to orient for late phase divergence", () => {
    observer.setExpectation("act", "Implementation succeeds");
    observer.evaluatePhase("act", "Error: implementation failed. Wrong approach entirely.");

    const remainingPhases = ["verify"];
    const decision = observer.getReplanDecision(remainingPhases);

    expect(decision?.revisedPlan[0]).toBe("orient");
  });

  test("multiple error keywords compound error signal score", () => {
    observer.setExpectation("decide", "We will use approach A");
    const actual = "Error: approach failed. Unexpected exception. Unable to proceed. Wrong assumption.";

    const result = observer.evaluatePhase("decide", actual);

    const errorFactor = result.factors.find(f => f.name === "error_signals");
    expect(errorFactor?.score).toBe(1.0);
  });

  test("common words filtered from topic drift calculation", () => {
    observer.setExpectation("orient", "The user authentication system");
    const actual = "The shopping cart system";

    const result = observer.evaluatePhase("orient", actual);

    // "The" and "system" are common, but "user", "authentication" vs "shopping", "cart" differ
    const topicFactor = result.factors.find(f => f.name === "topic_drift");
    expect(topicFactor).toBeDefined();
    expect(topicFactor!.score).toBeGreaterThan(0);
  });

  test("custom divergence threshold configuration", () => {
    const config = { divergenceThreshold: 0.5 };
    observer = new PlanningObserver(config);

    observer.setExpectation("decide", "Expected");
    // Create moderate divergence (around 0.4)
    const actual = "Actually, something different happened";

    const result = observer.evaluatePhase("decide", actual);

    // Score around 0.2-0.4, below custom threshold of 0.5
    expect(result.shouldReplan).toBe(false);
  });

  test("zero-length expected outcome handles gracefully", () => {
    observer.setExpectation("observe", "");
    const actual = "Some actual outcome";

    const result = observer.evaluatePhase("observe", actual);

    // Should not crash, returns some divergence
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.factors).toBeDefined();
  });

  test("identical expected and actual yields zero divergence", () => {
    const text = "Complete analysis of the authentication system with all components identified";
    observer.setExpectation("observe", text);

    const result = observer.evaluatePhase("observe", text);

    expect(result.score).toBe(0);
    expect(result.shouldReplan).toBe(false);
  });

  test("replan count increments only when replan decision made", () => {
    expect(observer.getReplanCount()).toBe(0);

    // Low divergence - no replan
    observer.setExpectation("observe", "Test");
    observer.evaluatePhase("observe", "Test completed");
    expect(observer.getReplanCount()).toBe(0);

    // High divergence - triggers replan
    observer.setExpectation("orient", "Expected");
    observer.evaluatePhase("orient", "Error: failed completely");
    observer.getReplanDecision(["decide"]);
    expect(observer.getReplanCount()).toBe(1);
  });
});
