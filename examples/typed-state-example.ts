/**
 * Example demonstrating TypeScript support for state in @torgon/mule workflows
 *
 * This example shows how to use strongly typed state across workflow steps,
 * using the Mastra-style stateSchema approach where each step declares what
 * state properties it needs.
 */

import { createStep, createWorkflow, Mule } from "../main.ts";
import { z } from "zod";

// ============================================================================
// Example 1: Basic stateSchema usage
// Each step declares the state properties it requires via stateSchema
// ============================================================================

console.log("=== Example 1: Basic stateSchema Usage ===\n");

// Step 1: Validates order and sets userId and totalAmount in state
const validateOrderStep = createStep({
  id: "validateOrder",
  inputSchema: z.object({
    userId: z.string(),
    items: z.array(z.object({
      name: z.string(),
      price: z.number(),
    })),
  }),
  outputSchema: z.boolean(),
  // This step requires userId and totalAmount in state
  stateSchema: z.object({
    userId: z.string(),
    totalAmount: z.number(),
  }),
  executor: async ({ input, setState }) => {
    // Use setState to update state - TypeScript knows the shape!
    setState({
      userId: input.userId,
      totalAmount: input.items.reduce((sum, item) => sum + item.price, 0),
    });

    // Return whether order is valid (minimum amount check)
    return input.items.reduce((sum, item) => sum + item.price, 0) >= 10;
  },
});

// Step 2: Fetches user details, accesses state.userId
const fetchUserStep = createStep({
  id: "fetchUser",
  inputSchema: z.boolean(),
  outputSchema: z.object({
    name: z.string(),
    email: z.string(),
  }),
  // This step needs userId from state and adds userName
  stateSchema: z.object({
    userId: z.string(),
    userName: z.string().optional(),
  }),
  executor: async ({ input, state, setState }) => {
    if (!input) {
      throw new Error("Order validation failed");
    }

    // Access state.userId with full type safety
    const userDetails = {
      name: `User ${state.userId}`,
      email: `${state.userId}@example.com`,
    };

    // Update state with user name
    setState({ userName: userDetails.name });

    return userDetails;
  },
});

// Step 3: Processes order, accesses multiple state properties
const processOrderStep = createStep({
  id: "processOrder",
  inputSchema: z.object({
    name: z.string(),
    email: z.string(),
  }),
  outputSchema: z.object({
    orderId: z.string(),
    status: z.string(),
  }),
  // This step needs userName and totalAmount
  stateSchema: z.object({
    userName: z.string().optional(),
    totalAmount: z.number(),
    processedAt: z.date().optional(),
  }),
  executor: async ({ state, setState }) => {
    console.log(`Processing order for ${state.userName}`);
    console.log(`Total amount: $${state.totalAmount}`);

    // Mark when the order was processed
    setState({ processedAt: new Date() });

    return {
      orderId: `ORD-${Date.now()}`,
      status: "completed",
    };
  },
});

// ============================================================================
// Example 2: Using setState for incremental updates
// ============================================================================

console.log("=== Example 2: setState for Incremental Updates ===\n");

const counterStep = createStep({
  id: "counter",
  inputSchema: z.undefined(),
  outputSchema: z.number(),
  stateSchema: z.object({
    count: z.number(),
    history: z.array(z.number()),
  }),
  executor: async ({ state, setState }) => {
    const newCount = state.count + 1;

    // setState merges with existing state
    setState({
      count: newCount,
      history: [...state.history, newCount],
    });

    return newCount;
  },
});

// ============================================================================
// Example 3: Parallel steps with shared state
// All parallel steps can read/write the same state
// ============================================================================

console.log("=== Example 3: Parallel Steps with Shared State ===\n");

const trackViewsStep = createStep({
  id: "trackViews",
  inputSchema: z.undefined(),
  outputSchema: z.number(),
  stateSchema: z.object({
    views: z.number(),
  }),
  executor: async ({ setState }) => {
    const views = 150;
    setState({ views });
    return views;
  },
});

const trackClicksStep = createStep({
  id: "trackClicks",
  inputSchema: z.undefined(),
  outputSchema: z.number(),
  stateSchema: z.object({
    clicks: z.number(),
  }),
  executor: async ({ setState }) => {
    const clicks = 45;
    setState({ clicks });
    return clicks;
  },
});

const trackConversionsStep = createStep({
  id: "trackConversions",
  inputSchema: z.undefined(),
  outputSchema: z.number(),
  stateSchema: z.object({
    conversions: z.number(),
  }),
  executor: async ({ setState }) => {
    const conversions = 12;
    setState({ conversions });
    return conversions;
  },
});

// ============================================================================
// Example 4: Nested workflows share state with parent
// ============================================================================

console.log("=== Example 4: Nested Workflows Share State ===\n");

// Create a nested workflow
const enrichmentWorkflow = createWorkflow()
  .addStep(createStep({
    id: "enrichData",
    inputSchema: z.string(),
    outputSchema: z.object({ enriched: z.string() }),
    stateSchema: z.object({
      enrichedBy: z.string().optional(),
    }),
    executor: async ({ input, setState }) => {
      setState({ enrichedBy: "enrichment-workflow" });
      return { enriched: input.toUpperCase() };
    },
  }));

// ============================================================================
// Running the examples
// ============================================================================

async function runExamples() {
  const mule = new Mule("typed-state-example", {
    persistence: { enabled: false },
  });

  // Example 1: Order processing workflow
  console.log("Running order processing workflow...");
  const orderWorkflow = mule.createWorkflow({
    inputSchema: z.object({
      userId: z.string(),
      items: z.array(z.object({
        name: z.string(),
        price: z.number(),
      })),
    }),
  })
    .addStep(validateOrderStep)
    .addStep(fetchUserStep)
    .addStep(processOrderStep);

  const orderResult = await orderWorkflow.run({
    initialInput: {
      userId: "user123",
      items: [
        { name: "Book", price: 15.99 },
        { name: "Pen", price: 2.99 },
      ],
    },
  });

  console.log("Order Result:", orderResult);
  console.log("Final State:", orderWorkflow.getState());
  console.log();

  // Example 2: Counter workflow
  console.log("Running counter workflow...");
  const counterWorkflow = mule.createWorkflow({
    state: { count: 0, history: [] as number[] },
  })
    .addStep(counterStep)
    .addStep(counterStep)
    .addStep(counterStep);

  await counterWorkflow.run();
  console.log("Counter State:", counterWorkflow.getState());
  console.log();

  // Example 3: Parallel analytics tracking
  console.log("Running parallel analytics workflow...");
  const analyticsWorkflow = mule.createWorkflow({
    state: { views: 0, clicks: 0, conversions: 0 },
  });
  analyticsWorkflow.parallel([trackViewsStep, trackClicksStep, trackConversionsStep]);

  await analyticsWorkflow.run();
  const analyticsState = analyticsWorkflow.getState();
  console.log("Analytics State:", analyticsState);
  console.log(`Conversion Rate: ${((analyticsState.conversions / analyticsState.views) * 100).toFixed(2)}%`);
  console.log();

  // Example 4: Nested workflow with shared state
  console.log("Running nested workflow...");
  const parentWorkflow = mule.createWorkflow({
    state: { parentData: "initial", enrichedBy: undefined as string | undefined },
  })
    .addStep(createStep({
      id: "setup",
      inputSchema: z.undefined(),
      outputSchema: z.string(),
      stateSchema: z.object({ parentData: z.string() }),
      executor: async ({ state }) => {
        return state.parentData;
      },
    }))
    .addStep(enrichmentWorkflow as any);

  await parentWorkflow.run();
  console.log("Parent State after nested workflow:", parentWorkflow.getState());
}

// Run if this is the main module
if (import.meta.main) {
  await runExamples();
}
