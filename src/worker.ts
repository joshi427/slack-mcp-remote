// Cloudflare Worker for Slack MCP Server
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequest,
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Define Slack API response types
interface SlackApiResponse {
  ok: boolean;
  error?: string;
}

interface SlackChannelResponse extends SlackApiResponse {
  channel?: {
    is_archived: boolean;
    [key: string]: any;
  };
}

interface SlackChannelsResponse extends SlackApiResponse {
  channels: any[];
  response_metadata: { next_cursor: string };
}

interface SlackMessageResponse extends SlackApiResponse {
  ts?: string;
  channel?: string;
}

// Tool definitions
const listChannelsTool: Tool = {
  name: "slack_list_channels",
  description: "List public or pre-defined channels in the workspace with pagination",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description:
          "Maximum number of channels to return (default 100, max 200)",
        default: 100,
      },
      cursor: {
        type: "string",
        description: "Pagination cursor for next page of results",
      },
    },
  },
};

const postMessageTool: Tool = {
  name: "slack_post_message",
  description: "Post a new message to a Slack channel",
  inputSchema: {
    type: "object",
    properties: {
      channel_id: {
        type: "string",
        description: "The ID of the channel to post to",
      },
      text: {
        type: "string",
        description: "The message text to post",
      },
    },
    required: ["channel_id", "text"],
  },
};

const replyToThreadTool: Tool = {
  name: "slack_reply_to_thread",
  description: "Reply to a specific message thread in Slack",
  inputSchema: {
    type: "object",
    properties: {
      channel_id: {
        type: "string",
        description: "The ID of the channel containing the thread",
      },
      thread_ts: {
        type: "string",
        description: "The timestamp of the parent message in the format '1234567890.123456'. Timestamps in the format without the period can be converted by adding the period such that 6 numbers come after it.",
      },
      text: {
        type: "string",
        description: "The reply text",
      },
    },
    required: ["channel_id", "thread_ts", "text"],
  },
};

const addReactionTool: Tool = {
  name: "slack_add_reaction",
  description: "Add a reaction emoji to a message",
  inputSchema: {
    type: "object",
    properties: {
      channel_id: {
        type: "string",
        description: "The ID of the channel containing the message",
      },
      timestamp: {
        type: "string",
        description: "The timestamp of the message to react to",
      },
      reaction: {
        type: "string",
        description: "The name of the emoji reaction (without ::)",
      },
    },
    required: ["channel_id", "timestamp", "reaction"],
  },
};

const getChannelHistoryTool: Tool = {
  name: "slack_get_channel_history",
  description: "Get recent messages from a channel",
  inputSchema: {
    type: "object",
    properties: {
      channel_id: {
        type: "string",
        description: "The ID of the channel",
      },
      limit: {
        type: "number",
        description: "Number of messages to retrieve (default 10)",
        default: 10,
      },
    },
    required: ["channel_id"],
  },
};

const getThreadRepliesTool: Tool = {
  name: "slack_get_thread_replies",
  description: "Get all replies in a message thread",
  inputSchema: {
    type: "object",
    properties: {
      channel_id: {
        type: "string",
        description: "The ID of the channel containing the thread",
      },
      thread_ts: {
        type: "string",
        description: "The timestamp of the parent message",
      },
    },
    required: ["channel_id", "thread_ts"],
  },
};

const getUsersTool: Tool = {
  name: "slack_get_users",
  description:
    "Get a list of all users in the workspace with their basic profile information",
  inputSchema: {
    type: "object",
    properties: {
      cursor: {
        type: "string",
        description: "Pagination cursor for next page of results",
      },
      limit: {
        type: "number",
        description: "Maximum number of users to return (default 100, max 200)",
        default: 100,
      },
    },
  },
};

const getUserProfileTool: Tool = {
  name: "slack_get_user_profile",
  description: "Get detailed profile information for a specific user",
  inputSchema: {
    type: "object",
    properties: {
      user_id: {
        type: "string",
        description: "The ID of the user",
      },
    },
    required: ["user_id"],
  },
};

// SlackClient implementation
class SlackClient {
  botHeaders: { Authorization: string; "Content-Type": string };

  constructor(botToken: string) {
    this.botHeaders = {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    };
  }

  async getChannels(limit: number = 100, cursor?: string, env?: any): Promise<any> {
    const predefinedChannelIds = env?.SLACK_CHANNEL_IDS;
    if (!predefinedChannelIds) {
      const params = new URLSearchParams({
        types: "public_channel",
        exclude_archived: "true",
        limit: Math.min(limit, 200).toString(),
        team_id: env?.SLACK_TEAM_ID || '',
      });
  
      if (cursor) {
        params.append("cursor", cursor);
      }
  
      const response = await fetch(
        `https://slack.com/api/conversations.list?${params}`,
        { headers: this.botHeaders },
      );
  
      const data = await response.json();
      return data as SlackChannelsResponse;
    }

    const predefinedChannelIdsArray = predefinedChannelIds.split(",").map((id: string) => id.trim());
    const channels = [];

    for (const channelId of predefinedChannelIdsArray) {
      const params = new URLSearchParams({
        channel: channelId,
      });

      const response = await fetch(
        `https://slack.com/api/conversations.info?${params}`,
        { headers: this.botHeaders }
      );
      const data = await response.json() as { ok: boolean; channel?: { is_archived: boolean; [key: string]: any } };

      if (data.ok && data.channel && !data.channel.is_archived) {
        channels.push(data.channel);
      }
    }

    return {
      ok: true,
      channels: channels,
      response_metadata: { next_cursor: "" },
    };
  }

  async postMessage(channel_id: string, text: string): Promise<any> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({
        channel: channel_id,
        text: text,
      }),
    });

    const data = await response.json();
    return data as SlackMessageResponse;
  }

  async postReply(
    channel_id: string,
    thread_ts: string,
    text: string,
  ): Promise<any> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({
        channel: channel_id,
        thread_ts: thread_ts,
        text: text,
      }),
    });

    const data = await response.json();
    return data as SlackMessageResponse;
  }

  async addReaction(
    channel_id: string,
    timestamp: string,
    reaction: string,
  ): Promise<any> {
    const response = await fetch("https://slack.com/api/reactions.add", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({
        channel: channel_id,
        timestamp: timestamp,
        name: reaction,
      }),
    });

    const data = await response.json();
    return data as SlackApiResponse;
  }

  async getChannelHistory(
    channel_id: string,
    limit: number = 10,
  ): Promise<any> {
    const params = new URLSearchParams({
      channel: channel_id,
      limit: limit.toString(),
    });

    const response = await fetch(
      `https://slack.com/api/conversations.history?${params}`,
      { headers: this.botHeaders },
    );

    const data = await response.json();
    return data as SlackApiResponse;
  }

  async getThreadReplies(channel_id: string, thread_ts: string): Promise<any> {
    const params = new URLSearchParams({
      channel: channel_id,
      ts: thread_ts,
    });

    const response = await fetch(
      `https://slack.com/api/conversations.replies?${params}`,
      { headers: this.botHeaders },
    );

    const data = await response.json();
    return data as SlackApiResponse;
  }

  async getUsers(limit: number = 100, cursor?: string): Promise<any> {
    const params = new URLSearchParams({
      limit: Math.min(limit, 200).toString(),
      team_id: process.env.SLACK_TEAM_ID!,
    });

    if (cursor) {
      params.append("cursor", cursor);
    }

    const response = await fetch(`https://slack.com/api/users.list?${params}`, {
      headers: this.botHeaders,
    });

    const data = await response.json();
    return data as SlackApiResponse;
  }

  async getUserProfile(user_id: string): Promise<any> {
    const params = new URLSearchParams({
      user: user_id,
      include_labels: "true",
    });

    const response = await fetch(
      `https://slack.com/api/users.profile.get?${params}`,
      { headers: this.botHeaders },
    );

    const data = await response.json();
    return data as SlackApiResponse;
  }
}

export default {
  async fetch(request: Request, env: any, ctx: any) {
    // Initialize the Slack client with the bot token from environment variables
    const botToken = env.SLACK_BOT_TOKEN;
    const teamId = env.SLACK_TEAM_ID;
    const channelIds = env.SLACK_CHANNEL_IDS;
    
    console.log('Environment variables check:', { 
      hasToken: !!botToken, 
      hasTeamId: !!teamId,
      hasChannelIds: !!channelIds,
      envKeys: Object.keys(env)
    });

    if (!botToken || !teamId) {
      return new Response(
        JSON.stringify({
          error: "Missing required environment variables: SLACK_BOT_TOKEN and SLACK_TEAM_ID",
          debug: {
            hasToken: !!botToken,
            hasTeamId: !!teamId,
            hasChannelIds: !!channelIds,
            envKeys: Object.keys(env)
          }
        }),
        {
          status: 500,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
          }
        }
      );
    }
    const server = new Server(
      {
        name: "Slack MCP Server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    const slackClient = new SlackClient(env.SLACK_BOT_TOKEN);

    // Set up the request handlers
    server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        try {
          if (!request.params.arguments) {
            throw new Error("No arguments provided");
          }

          // Handle tool calls based on the tool name
          switch (request.params.name) {
            case "slack_list_channels": {
              const args = request.params.arguments as any;
              const response = await slackClient.getChannels(
                args.limit,
                args.cursor,
                env
              );
              return {
                content: [{ type: "text", text: JSON.stringify(response) }],
              };
            }

            case "slack_post_message": {
              const args = request.params.arguments as any;
              if (!args.channel_id || !args.text) {
                throw new Error(
                  "Missing required arguments: channel_id and text"
                );
              }
              const response = await slackClient.postMessage(
                args.channel_id,
                args.text
              );
              return {
                content: [{ type: "text", text: JSON.stringify(response) }],
              };
            }

            case "slack_reply_to_thread": {
              const args = request.params.arguments as any;
              if (!args.channel_id || !args.thread_ts || !args.text) {
                throw new Error(
                  "Missing required arguments: channel_id, thread_ts, and text"
                );
              }
              const response = await slackClient.postReply(
                args.channel_id,
                args.thread_ts,
                args.text
              );
              return {
                content: [{ type: "text", text: JSON.stringify(response) }],
              };
            }

            case "slack_add_reaction": {
              const args = request.params.arguments as any;
              if (!args.channel_id || !args.timestamp || !args.reaction) {
                throw new Error(
                  "Missing required arguments: channel_id, timestamp, and reaction"
                );
              }
              const response = await slackClient.addReaction(
                args.channel_id,
                args.timestamp,
                args.reaction
              );
              return {
                content: [{ type: "text", text: JSON.stringify(response) }],
              };
            }

            case "slack_get_channel_history": {
              const args = request.params.arguments as any;
              if (!args.channel_id) {
                throw new Error("Missing required argument: channel_id");
              }
              const response = await slackClient.getChannelHistory(
                args.channel_id,
                args.limit
              );
              return {
                content: [{ type: "text", text: JSON.stringify(response) }],
              };
            }

            case "slack_get_thread_replies": {
              const args = request.params.arguments as any;
              if (!args.channel_id || !args.thread_ts) {
                throw new Error(
                  "Missing required arguments: channel_id and thread_ts"
                );
              }
              const response = await slackClient.getThreadReplies(
                args.channel_id,
                args.thread_ts
              );
              return {
                content: [{ type: "text", text: JSON.stringify(response) }],
              };
            }

            case "slack_get_users": {
              const args = request.params.arguments as any;
              const response = await slackClient.getUsers(
                args.limit,
                args.cursor
              );
              return {
                content: [{ type: "text", text: JSON.stringify(response) }],
              };
            }

            case "slack_get_user_profile": {
              const args = request.params.arguments as any;
              if (!args.user_id) {
                throw new Error("Missing required argument: user_id");
              }
              const response = await slackClient.getUserProfile(args.user_id);
              return {
                content: [{ type: "text", text: JSON.stringify(response) }],
              };
            }

            default:
              throw new Error(`Unknown tool: ${request.params.name}`);
          }
        } catch (error) {
          console.error("Error executing tool:", error);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: error instanceof Error ? error.message : String(error),
                }),
              },
            ],
          };
        }
      }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          listChannelsTool,
          postMessageTool,
          replyToThreadTool,
          addReactionTool,
          getChannelHistoryTool,
          getThreadRepliesTool,
          getUsersTool,
          getUserProfileTool,
        ],
      };
    });

    // Create a custom handler for Cloudflare Workers
    // Parse the incoming request
    try {
      const requestText = await request.text();
      let requestBody;
      
      try {
        requestBody = JSON.parse(requestText);
      } catch (e) {
        console.error('Failed to parse request JSON:', e, 'Raw request:', requestText);
        return new Response(JSON.stringify({ error: 'Invalid JSON in request' }), {
          status: 400,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          }
        });
      }
      
      console.log('Received request:', JSON.stringify(requestBody));
      
      // Handle MCP requests - support both direct method calls and type-based format
      const isCallTool = requestBody.type === 'call_tool' || requestBody.method === 'tools/call';
      const isListTools = requestBody.type === 'list_tools' || requestBody.method === 'tools/list' || requestBody.method === 'list';
      const isInitialize = requestBody.method === 'initialize';
      const isNotification = requestBody.method && requestBody.method.startsWith('notifications/');
      
      if (isCallTool) {
        // Process the call_tool request manually
        // Create a properly formatted request object that matches CallToolRequest
        const callToolRequest = {
          method: 'tools/call',
          params: {
            name: (requestBody.params?.name || requestBody.params?.tool || ''),
            arguments: (requestBody.params?.arguments || requestBody.params?.parameters || {}),
            _meta: requestBody.params?._meta
          }
        } as CallToolRequest;
        
        // Call the tool handler directly
        try {
          if (!callToolRequest.params.arguments) {
            throw new Error("No arguments provided");
          }

          // Handle tool calls based on the tool name
          let result;
          switch (callToolRequest.params.name) {
            case "slack_list_channels": {
              const args = callToolRequest.params.arguments as any;
              const response = await slackClient.getChannels(
                args.limit,
                args.cursor
              );
              result = {
                content: [{ type: "text", text: JSON.stringify(response) }],
              };
              break;
            }
            case "slack_post_message": {
              const args = callToolRequest.params.arguments as any;
              if (!args.channel_id || !args.text) {
                throw new Error(
                  "Missing required arguments: channel_id and text"
                );
              }
              const response = await slackClient.postMessage(
                args.channel_id,
                args.text
              );
              result = {
                content: [{ type: "text", text: JSON.stringify(response) }],
              };
              break;
            }
            case "slack_reply_to_thread": {
              const args = callToolRequest.params.arguments as any;
              if (!args.channel_id || !args.thread_ts || !args.text) {
                throw new Error(
                  "Missing required arguments: channel_id, thread_ts, and text"
                );
              }
              const response = await slackClient.postReply(
                args.channel_id,
                args.thread_ts,
                args.text
              );
              result = {
                content: [{ type: "text", text: JSON.stringify(response) }],
              };
              break;
            }
            case "slack_add_reaction": {
              const args = callToolRequest.params.arguments as any;
              if (!args.channel_id || !args.timestamp || !args.reaction) {
                throw new Error(
                  "Missing required arguments: channel_id, timestamp, and reaction"
                );
              }
              const response = await slackClient.addReaction(
                args.channel_id,
                args.timestamp,
                args.reaction
              );
              result = {
                content: [{ type: "text", text: JSON.stringify(response) }],
              };
              break;
            }
            case "slack_get_channel_history": {
              const args = callToolRequest.params.arguments as any;
              if (!args.channel_id) {
                throw new Error("Missing required argument: channel_id");
              }
              const response = await slackClient.getChannelHistory(
                args.channel_id,
                args.limit
              );
              result = {
                content: [{ type: "text", text: JSON.stringify(response) }],
              };
              break;
            }
            case "slack_get_thread_replies": {
              const args = callToolRequest.params.arguments as any;
              if (!args.channel_id || !args.thread_ts) {
                throw new Error(
                  "Missing required arguments: channel_id and thread_ts"
                );
              }
              const response = await slackClient.getThreadReplies(
                args.channel_id,
                args.thread_ts
              );
              result = {
                content: [{ type: "text", text: JSON.stringify(response) }],
              };
              break;
            }
            case "slack_get_users": {
              const args = callToolRequest.params.arguments as any;
              const response = await slackClient.getUsers(
                args.limit,
                args.cursor
              );
              result = {
                content: [{ type: "text", text: JSON.stringify(response) }],
              };
              break;
            }
            case "slack_get_user_profile": {
              const args = callToolRequest.params.arguments as any;
              if (!args.user_id) {
                throw new Error("Missing required argument: user_id");
              }
              const response = await slackClient.getUserProfile(args.user_id);
              result = {
                content: [{ type: "text", text: JSON.stringify(response) }],
              };
              break;
            }
            default:
              throw new Error(`Unknown tool: ${callToolRequest.params.name}`);
          }
          
          // Format response according to JSON-RPC format with the request ID
          const response = {
            jsonrpc: "2.0",
            id: requestBody.id !== undefined ? requestBody.id : 0,
            result: result
          };
          
          return new Response(JSON.stringify(response), {
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type'
            }
          });
        } catch (error) {
          return new Response(JSON.stringify({
            content: [{
              type: "text",
              text: JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            }],
          }), {
            headers: { 
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type'
            }
          });
        }
      } else if (isListTools) {
        // Return the list of tools directly
        console.log('Handling tools/list request:', JSON.stringify(requestBody));
        
        const tools = [
          listChannelsTool,
          postMessageTool,
          replyToThreadTool,
          addReactionTool,
          getChannelHistoryTool,
          getThreadRepliesTool,
          getUsersTool,
          getUserProfileTool,
        ];
        
        // Format response according to JSON-RPC format with the request ID
        const response = {
          jsonrpc: "2.0",
          id: requestBody.id || 0,
          result: {
            tools: tools
          }
        };
        
        return new Response(JSON.stringify(response), {
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          }
        });
      } else if (isInitialize) {
        // Handle initialize method for MCP protocol
        console.log('Handling initialize request:', JSON.stringify(requestBody));
        
        // Respond with server capabilities
        const response = {
          jsonrpc: "2.0",
          id: requestBody.id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: {
              name: "slack-mcp-remote",
              version: "1.0.0"
            },
            capabilities: {
              tools: {}
            }
          }
        };
        
        return new Response(JSON.stringify(response), {
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          }
        });
      } else if (isNotification) {
        // Handle notification methods (like notifications/initialized)
        console.log('Handling notification:', requestBody.method, JSON.stringify(requestBody));
        
        // For notifications, we just need to acknowledge receipt
        // Notifications don't require a response with an ID as they don't expect a response
        return new Response(JSON.stringify({ jsonrpc: "2.0", result: null }), {
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          }
        });
      } else if (request.method === 'OPTIONS') {
        // Handle CORS preflight requests
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
          }
        });
      }
      
      // Log the unhandled request for debugging
      console.error('Unhandled request type:', requestBody);
      
      // If we get here, either the request type is unsupported or we couldn't find a handler
      return new Response(JSON.stringify({ error: 'Unsupported request type or missing handler', received: requestBody }), {
        status: 400,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Invalid request format' }), {
        status: 400,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }
  },
};
