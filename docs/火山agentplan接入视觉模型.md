方舟 Agent Plan 提供图片生成、视频生成模型，支持通过 Skill、API 接口调用两种方式接入并使用生图、生视频能力。

<span id="dd9e9bb8"></span>
# 通过 Skill 接入

在 AI 工具中使用图片生成、视频生成能力，建议使用 Skill 方式接入。

<span id="a09527a3"></span>
## 方式 1：自动化助手（推荐）

**支持的 AI 工具** ：Claude Code、OpenCode、OpenClaw。

Ark Helper 是一个编码工具助手，支持快速配置选择的工具接入 Agent Plan。安装并运行该助手，根据界面提示操作可自动完成工具配置，其中包括自动完成视频生成Skill（[byted-ark-seedance-skill](https://findskill.com/volcengine/agentplan/byted-ark-seedance-skill)）、图片生成 Skill（[byted-ark-seedream-skill](https://findskill.com/volcengine/agentplan/byted-ark-seedream-skill)） 的安装配置，有效降低手动配置的时间成本和出错风险。

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div>



* <div data-tips="true" data-tips-type="warning">Ark Helper 仅支持 macOS、Linux 系统，暂不支持 Windows 系统。</div>


* <div data-tips="true" data-tips-type="warning">以下配置步骤及截图为 Ark Helper 首次使用指引；非首次使用请按界面提示完成套餐配置和工具配置。</div>


1. 执行以下命令安装 Ark Helper。

   ```Bash
   curl -fsSL https://lf3-static.bytednsdoc.com/obj/eden-cn/ylwslo-yrh/ljhwZthlaukjlkulzlp/install.sh | sh
   ```
   


安装完成后，执行以下命令查看安装的版本号。

```Bash
ark-helper --version
```



2. 在命令行界面输入`ark-helper`命令，启动 Ark Helper。默认选择 **中文** 。

   <span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/c5bbcdc78c994e5e826b80b47980fe22~tplv-goo7wpa0wc-image.image) </span>

3. 根据界面提示完成套餐配置。

   1. 选择要配置的套餐：`[Volcano] Volcano Engine (国内)` \- `Agent Plan`。

      <span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/bafbcdfd088e4a04890eed2c22e0ee76~tplv-goo7wpa0wc-image.image) </span>

   2. 配置 API Key：推荐选择 `SSO 登录自动获取 API Key 和联网密钥`。根据界面提示完成登录并选择要使用的联网密钥。

      <span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e3774e133009444983b0c7da9e60b483~tplv-goo7wpa0wc-image.image) </span>

   3. 选择默认模型。

      <span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/03b3f3f6886c489482ca284c758b7a71~tplv-goo7wpa0wc-image.image) </span>

4. 根据界面提示点击返回，完成工具配置。以 Claude Code 配置为例，具体步骤如下。

   1. 选择编码工具：`Claude Code`。

      <span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/7c7448bb8cdb4c39b363a797db468080~tplv-goo7wpa0wc-image.image) </span>

   2. 选择操作：`设置 Volcano Agent Plan (API Key + Skills + MCP) 到 Claude Code`，配置完成后，选择`退出`。如果需要重新配置工具，可先选择`卸载 Claude Code 配置`，再重新进行配置流程。

      <span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/4ffccd0ae3034853b983a3ef560ad176~tplv-goo7wpa0wc-image.image) </span>


完成上述操作后，将自动完成视觉模型 Skill、豆包搜索 Skill / MCP 的安装，无需手动安装。

5. 启动配置好的工具，发送视频生成/图片生成提示词，将会触发视觉模型 Skill 生成视频/图片。

<span id="72de147a"></span>
## 方式 2：手动安装 Skill

<span id="df302b39"></span>
### 安装视频生成 Skill

通过 Skill 方式，可以快速为 AI 工具安装并接入视频生成能力，目前支持的 AI 工具：OpenClaw、Hermes Agent、Claude Code。视频生成 Skill 信息参见 [byted-ark-seedance-skill](https://findskill.com/volcengine/agentplan/byted-ark-seedance-skill)。


<Tabs>
<Tab zoneid="n7ThgoHUQc" title="OpenClaw">
<TabTitle>OpenClaw</TabTitle>

1. 已完成 OpenClaw 的安装及语言模型的配置，具体步骤见 [OpenClaw](https://docs.volcengine.com/docs/82379/2373742)。

2. 在终端执行以下命令为 OpenClaw 安装并接入视频生成 Skill `byted-ark-seedance-skill`。

   ```Bash
   npx skills add https://skills.volces.com/skills/volcengine/agentplan -s byted-ark-seedance-skill --agent openclaw
   ```
   

3. 安装完成后，可以在 OpenClaw 发送视频生成的提示词，触发并使用生成视频能力。


</Tab>
<Tab zoneid="FN89qtYgTO" title="Hermes Agent">
<TabTitle>Hermes Agent</TabTitle>

1. 已完成 Hermes Agent 的安装及语言模型的配置，具体步骤见 [Hermes Agent](https://docs.volcengine.com/docs/82379/2318283)。

2. 进入 [byted-ark-seedance-skill](https://findskill.com/volcengine/agentplan/byted-ark-seedance-skill) 页面下载 ZIP 压缩包，将解压后的文件粘贴至`~/.hermes/skills/`目录下。

3. 配置完成后，可以在 Hermes Agent 发送视频生成的提示词，触发并使用生成视频能力。


</Tab>
<Tab zoneid="im9GPvQain" title="Claude Code">
<TabTitle>Claude Code</TabTitle>

1. 已完成 Claude Code 的安装及语言模型的配置，具体步骤见 [Claude Code](https://docs.volcengine.com/docs/82379/2373740)。

2. 在终端执行以下命令为 Claude Code 安装并接入视频生成 Skill `byted-ark-seedance-skill`。

   ```Bash
   npx skills add https://skills.volces.com/skills/volcengine/agentplan -s byted-ark-seedance-skill --agent claude-code
   ```
   

3. 配置完成后，可以在 Claude Code 发送视频生成的提示词，触发并使用生成视频能力。


</Tab>
<Tab zoneid="i3hG2Za2QF" title="TRAE">
<TabTitle>TRAE</TabTitle>

1. 已完成 TRAE 的安装及语言模型的配置，具体步骤见 [TRAE](https://docs.volcengine.com/docs/82379/2389869)。

2. 在终端执行以下命令下载 `byted-ark-seedance-skill`。

   ```Bash
   npx skills add https://skills.volces.com/skills/volcengine/agentplan -s byted-ark-seedance-skill --agent trae
   ```
   

3. 安装完成后，可以在 TRAE 发送视频生成的提示词，触发并使用生成视频能力。


</Tab>
</Tabs>


<span id="aef48a5c"></span>
### 安装图片生成 Skill

通过 Skill 方式，可以快速为 AI 工具安装并接入图片生成能力，目前支持的 AI 工具：OpenClaw、Hermes Agent、Claude Code。图片生成 Skill 信息参见 [byted-ark-seedream-skill](https://findskill.com/volcengine/agentplan/byted-ark-seedream-skill)。


<Tabs>
<Tab zoneid="JrG8D3OeRa" title="OpenClaw">
<TabTitle>OpenClaw</TabTitle>

1. 已完成 OpenClaw 的安装及语言模型的配置，具体步骤见 [OpenClaw](https://docs.volcengine.com/docs/82379/2373742)。

2. 在终端执行以下命令为 OpenClaw 安装并接入图片生成 Skill `byted-ark-seedream-skill`。

   ```Bash
   npx skills add https://skills.volces.com/skills/volcengine/agentplan -s byted-ark-seedream-skill --agent openclaw
   ```
   

3. 安装完成后，可以在 OpenClaw 发送图片生成的提示词，触发并使用生成图片能力。


</Tab>
<Tab zoneid="ATz6LdaNkl" title="Hermes Agent">
<TabTitle>Hermes Agent</TabTitle>

1. 已完成 Hermes Agent 的安装及语言模型的配置，具体步骤见 [Hermes Agent](https://docs.volcengine.com/docs/82379/2318283)。

2. 进入 [byted-ark-seedream-skill](https://findskill.com/volcengine/agentplan/byted-ark-seedream-skill) 页面下载 ZIP 压缩包，将解压后的文件粘贴至`~/.hermes/skills/`目录下。

3. 安装完成后，可以在 Hermes Agent 发送图片生成的提示词，触发并使用生成图片能力。


</Tab>
<Tab zoneid="X7m2cHjE9g" title="Claude Code">
<TabTitle>Claude Code</TabTitle>

1. 已完成 Claude Code 的安装及语言模型的配置，具体步骤见 [Claude Code](https://docs.volcengine.com/docs/82379/2373740)。

2. 在终端执行以下命令为 Claude Code 安装并接入图片生成 Skill `byted-ark-seedream-skill`。

   ```Bash
   npx skills add https://skills.volces.com/skills/volcengine/agentplan -s byted-ark-seedream-skill --agent claude-code
   ```
   

3. 安装完成后，可以在 Claude Code 发送图片生成的提示词，触发并使用生成图片能力。


</Tab>
<Tab zoneid="HlLH40gRZl" title="TRAE">
<TabTitle>TRAE</TabTitle>

1. 已完成 TRAE 的安装及语言模型的配置，具体步骤见 [TRAE](https://docs.volcengine.com/docs/82379/2389869)。

2. 在终端执行以下命令下载 `byted-ark-seedream-skill`。

   ```Bash
   npx skills add https://skills.volces.com/skills/volcengine/agentplan -s byted-ark-seedream-skill --agent trae
   ```
   

3. 安装完成后，可以在 TRAE 发送图片生成的提示词，触发并使用生成图片能力。


</Tab>
</Tabs>


<span id="b9ddd4f1"></span>
# 通过 API 接入

如果使用的 AI 工具不支持接入 Skill，或者无需在 AI 工具中使用，可通过 API 接入的方式使用图片生成、视频生成能力。

<span id="8d00fec2"></span>
## 核心配置信息

在使用 Agent Plan 时，需要使用专属 API Key、专属 Base URL、支持的模型来调用视频生成、图片生成 API，否则可能会调用失败或产生额外费用。


* **专属 API Key** ：[获取专属 API Key](https://console.volcengine.com/ark/region:cn-beijing/openManagement?LLM=%7B%7D&OpenModelVisible=false&advancedActiveKey=agentPlan)，其他方舟 API Key 如 Coding Plan API Key 无法在 Agent Plan 中使用。

   <span>![图片](https://arkdoc.tos-cn-beijing.volces.com/images/console3-pic/ap-person-apikey.png) </span>

* **支持的模型** ：见[支持模型及 Harness](https://docs.volcengine.com/docs/82379/2366394#3d801f5f)。

* **专属 Base URL** ：Agent Plan 对应的 API 接口信息中包含`/plan`，请勿混用其他 API 接口。

   * Curl 方式：支持的 API 参数可查看对应的 API 文档。

      
      |视频生成 API |图片生成 API |
      |---|---|
      |* [创建视频生成任务](https://docs.volcengine.com/docs/82379/1520757)：`https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks`<br><br>* [查询视频生成任务](https://docs.volcengine.com/docs/82379/1521309)：`https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks/{id}`<br><br>* [查询视频生成任务列表](https://docs.volcengine.com/docs/82379/1521675)：`https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks?page_num={page_num}&page_size={page_size}&filter.status={filter.status}&filter.task_ids={filter.task_ids}&filter.model={filter.model}`<br><br>* [取消或删除视频生成任务](https://docs.volcengine.com/docs/82379/1521720)：`https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks/{id}` |[图片生成](https://docs.volcengine.com/docs/82379/1541523)：`https://ark.cn-beijing.volces.com/api/plan/v3/images/generations` |
      

   * SDK 方式：

      专属 Base URL：`https://ark.cn-beijing.volces.com/api/plan/v3`

       &nbsp;


<span id=".6LCD55So6KeG6aKR55Sf5oiQLWFwaQ=="></span>
## 调用视频生成 API

参见[视频生成教程](https://docs.volcengine.com/docs/82379/2298881)、[Doubao Seedance 2.0 系列教程](https://docs.volcengine.com/docs/82379/2291680)完成视频生成任务，需注意必须使用 Agent Plan 专属 API Key、专属 Base URL 及支持的模型，否则可能会调用失败或产生额外费用。具体参见[核心配置信息](https://docs.volcengine.com/docs/82379/2375486#8d00fec2)。

通过 Agent Plan 创建视频生成任务的示例如下：


<Tabs>
<Tab zoneid="PLA2EyrY3l" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -d '{
    "model": "doubao-seedance-2.0",
    "content": [
        {
            "type": "text",
            "text": "女孩抱着狐狸，女孩睁开眼，温柔地看向镜头，狐狸友善地抱着，镜头缓缓拉出，女孩的头发被风吹动，可以听到风声"
        },
        {
            "type": "image_url",
            "image_url": {
                "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/i2v_foxrgirl.png"
            }
        }
    ],
    "generate_audio": true,
    "ratio": "adaptive",
    "duration": 5,
    "watermark": false
}'
```



</Tab>
<Tab zoneid="AxPr03UG6W" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
from volcenginesdkarkruntime import Ark

client = Ark(
    # Agent Plan 专属 Base URL
    base_url="https://ark.cn-beijing.volces.com/api/plan/v3",
    # Agent Plan 专属 API Key：https://console.volcengine.com/ark/region:cn-beijing/openManagement?LLM=%7B%7D&OpenModelVisible=false&advancedActiveKey=agentPlan
    api_key=os.environ.get("AGENT_API_KEY")
)

if __name__ == "__main__":
    print("----- create request -----")
    resp = client.content_generation.tasks.create(
        model="doubao-seedance-2.0",
        content=[
            {
                "text": (
                    "女孩抱着狐狸，女孩睁开眼，温柔地看向镜头，狐狸友善地抱着，镜头缓缓拉出，女孩的头发被风吹动"
                ),
                "type": "text"
            },
            {
                "image_url": {
                    "url": (
                        "https://ark-project.tos-cn-beijing.volces.com/doc_image/i2v_foxrgirl.png"
                    )
                },
                "type": "image_url"
            }
        ],
        generate_audio=True,
        ratio="adaptive",
        duration=5,
        watermark=False,
    )

    print(resp)
```



</Tab>
<Tab zoneid="WRv86zaeMf" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.volcengine.ark.runtime.model.content.generation.*;
import com.volcengine.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest.Content;
import com.volcengine.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class ContentGenerationTaskExample {
    // Agent Plan 专属 API Key：https://console.volcengine.com/ark/region:cn-beijing/openManagement?LLM=%7B%7D&OpenModelVisible=false&advancedActiveKey=agentPlan
    static String apiKey = System.getenv("AGENT_API_KEY");
    static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
    static Dispatcher dispatcher = new Dispatcher();
    static ArkService service = ArkService.builder()
           .baseUrl("https://ark.cn-beijing.volces.com/api/plan/v3") // Agent Plan 专属 Base URL
           .dispatcher(dispatcher)
           .connectionPool(connectionPool)
           .apiKey(apiKey)
           .build();

    public static void main(String[] args) {
        String model = "doubao-seedance-2.0";
        Boolean generateAudio = true;
        String ratio = "adaptive";
        Long duration = 5L;
        Boolean watermark = false;
        System.out.println("----- create request -----");
        List<Content> contents = new ArrayList<>();

        // Combination of text prompt and parameters
        contents.add(Content.builder()
                .type("text")
                .text("女孩抱着狐狸，女孩睁开眼，温柔地看向镜头，狐狸友善地抱着，镜头缓缓拉出，女孩的头发被风吹动，可以听到风声")
                .build());
        // The URL of the first frame image
        contents.add(Content.builder()
                .type("image_url")
                .imageUrl(CreateContentGenerationTaskRequest.ImageUrl.builder()
                        .url("https://ark-project.tos-cn-beijing.volces.com/doc_image/i2v_foxrgirl.png")
                        .build())
                .build());

        // Create a video generation task
        CreateContentGenerationTaskRequest createRequest = CreateContentGenerationTaskRequest.builder()
                .model(model)
                .content(contents)
                .generateAudio(generateAudio)
                .ratio(ratio)
                .duration(duration)
                .watermark(watermark)
                .build();

        CreateContentGenerationTaskResult createResult = service.createContentGenerationTask(createRequest);
        System.out.println(createResult);

        service.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="aqux3hU2qB" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "time"

    "github.com/volcengine/volcengine-go-sdk/service/arkruntime"
    "github.com/volcengine/volcengine-go-sdk/service/arkruntime/model"
    "github.com/volcengine/volcengine-go-sdk/volcengine"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        // Agent Plan 专属 API Key：https://console.volcengine.com/ark/region:cn-beijing/openManagement?LLM=%7B%7D&OpenModelVisible=false&advancedActiveKey=agentPlan
        os.Getenv("AGENT_API_KEY"),
        // Agent Plan 专属 Base URL
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/plan/v3"),
    )
    ctx := context.Background()
    modelEp := "doubao-seedance-2.0"

    // Generate a task
    fmt.Println("----- create request -----")
    createReq := model.CreateContentGenerationTaskRequest{
        Model: modelEp,
        GenerateAudio: volcengine.Bool(true),
        Ratio:         volcengine.String("adaptive"),
        Duration:      volcengine.Int64(5),
        Watermark:     volcengine.Bool(false),
        Content: []*model.CreateContentGenerationContentItem{
            {
                // Combination of text prompt and parameters
                Type: model.ContentGenerationContentItemTypeText,
                Text: volcengine.String("女孩抱着狐狸，女孩睁开眼，温柔地看向镜头，狐狸友善地抱着，镜头缓缓拉出，女孩的头发被风吹动，可以听到风声"),
            },
            {
                // The URL of the first frame image
                Type: model.ContentGenerationContentItemTypeImage,
                ImageURL: &model.ImageURL{
                    URL: "https://ark-project.tos-cn-beijing.volces.com/doc_image/i2v_foxrgirl.png",
                },
            },
        },
    }
    createResp, err := client.CreateContentGenerationTask(ctx, createReq)
    if err != nil {
        fmt.Printf("create content generation error: %v", err)
        return
    }
    taskID := createResp.ID
    fmt.Printf("Task Created with ID: %s", taskID)
}
```



</Tab>
</Tabs>


<span id="4463e4c4"></span>
## 调用图片生成 API

参见 [Seedream 4.0-5.0 教程](https://docs.volcengine.com/docs/82379/1824121) 完成图片生成任务，需注意必须使用 Agent Plan 专属 API Key、专属 Base URL 及支持的模型，否则可能会调用失败或产生额外费用。具体参见[核心配置信息](https://docs.volcengine.com/docs/82379/2375486#8d00fec2)。

通过 Agent Plan 实现文生图的示例如下：


<Tabs>
<Tab zoneid="OyqYf5OU8h" title="Curl">
<TabTitle>Curl</TabTitle>

```Bash
curl https://ark.cn-beijing.volces.com/api/plan/v3/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AGENT_API_KEY" \
  -d '{
    "model": "doubao-seedream-5.0-lite",
    "prompt": "充满活力的特写编辑肖像，模特眼神犀利，头戴雕塑感帽子，色彩拼接丰富，眼部焦点锐利，景深较浅，具有Vogue杂志封面的美学风格，采用中画幅拍摄，工作室灯光效果强烈。",
    "size": "2K",
    "output_format":"png",
    "watermark": false
}'
```



</Tab>
<Tab zoneid="vKVdHZcp3s" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
# Install SDK:  pip install 'volcengine-python-sdk[ark]' .
from volcenginesdkarkruntime import Ark

client = Ark(
    # Agent Plan 专属 Base URL
    base_url="https://ark.cn-beijing.volces.com/api/plan/v3",
    # Agent Plan 专属 API Key：https://console.volcengine.com/ark/region:cn-beijing/openManagement?LLM=%7B%7D&OpenModelVisible=false&advancedActiveKey=agentPlan
    api_key=os.getenv('AGENT_API_KEY'),
)

imagesResponse = client.images.generate(
    model="doubao-seedream-5.0-lite",
    prompt="充满活力的特写编辑肖像，模特眼神犀利，头戴雕塑感帽子，色彩拼接丰富，眼部焦点锐利，景深较浅，具有Vogue杂志封面的美学风格，采用中画幅拍摄，工作室灯光效果强烈。",
    size="2K",
    output_format="png",
    response_format="url",
    watermark=False
)

print(imagesResponse.data[0].url)
```



</Tab>
<Tab zoneid="niZMXSeGUN" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;
import com.volcengine.ark.runtime.model.images.generation.*;
import com.volcengine.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class ImageGenerationsExample {
    public static void main(String[] args) {
        // Agent Plan 专属 API Key：https://console.volcengine.com/ark/region:cn-beijing/openManagement?LLM=%7B%7D&OpenModelVisible=false&advancedActiveKey=agentPlan
        String apiKey = System.getenv("AGENT_API_KEY");
        ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
        Dispatcher dispatcher = new Dispatcher();
        ArkService service = ArkService.builder()
                .baseUrl("https://ark.cn-beijing.volces.com/api/plan/v3") // Agent Plan 专属 Base URL
                .dispatcher(dispatcher)
                .connectionPool(connectionPool)
                .apiKey(apiKey)
                .build();

        GenerateImagesRequest generateRequest = GenerateImagesRequest.builder()
                .model("doubao-seedream-5.0-lite")
                .prompt("充满活力的特写编辑肖像，模特眼神犀利，头戴雕塑感帽子，色彩拼接丰富，眼部焦点锐利，景深较浅，具有Vogue杂志封面的美学风格，采用中画幅拍摄，工作室灯光效果强烈。")
                .size("2K")
                .sequentialImageGeneration("disabled")
                .outputFormat("png")
                .responseFormat(ResponseFormat.Url)
                .stream(false)
                .watermark(false)
                .build();
        ImagesResponse imagesResponse = service.generateImages(generateRequest);
        System.out.println(imagesResponse.getData().get(0).getUrl());

        service.shutdownExecutor();
    }
}
```



</Tab>
<Tab zoneid="ufELeRYZ0g" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"

    "github.com/volcengine/volcengine-go-sdk/service/arkruntime"
    "github.com/volcengine/volcengine-go-sdk/service/arkruntime/model"
    "github.com/volcengine/volcengine-go-sdk/volcengine"
)

func main() {
    client := arkruntime.NewClientWithApiKey(
        // Agent Plan 专属 API Key：https://console.volcengine.com/ark/region:cn-beijing/openManagement?LLM=%7B%7D&OpenModelVisible=false&advancedActiveKey=agentPlan
        os.Getenv("AGENT_API_KEY"),
        // // Agent Plan 专属 Base URL
        arkruntime.WithBaseUrl("https://ark.cn-beijing.volces.com/api/plan/v3"),
    )
    ctx := context.Background()
    outputFormat := model.OutputFormatPNG


    generateReq := model.GenerateImagesRequest{
       Model:          "doubao-seedream-5.0-lite",
       Prompt:         "充满活力的特写编辑肖像，模特眼神犀利，头戴雕塑感帽子，色彩拼接丰富，眼部焦点锐利，景深较浅，具有Vogue杂志封面的美学风格，采用中画幅拍摄，工作室灯光效果强烈。",
       Size:           volcengine.String("2K"),
       OutputFormat:   &outputFormat,
       ResponseFormat: volcengine.String("url"),
       Watermark:      volcengine.Bool(false),
    }

    imagesResponse, err := client.GenerateImages(ctx, generateReq)
    if err != nil {
       fmt.Printf("generate images error: %v\n", err)
       return
    }

    fmt.Printf("%s\n", *imagesResponse.Data[0].Url)
}
```



</Tab>
<Tab zoneid="gayhLC80j8" title="OpenAI">
<TabTitle>OpenAI</TabTitle>

```Python
import os
from openai import OpenAI

client = OpenAI(
    # Agent Plan 专属 Base URL
    base_url="https://ark.cn-beijing.volces.com/api/plan/v3",
    # Agent Plan 专属 API Key：https://console.volcengine.com/ark/region:cn-beijing/openManagement?LLM=%7B%7D&OpenModelVisible=false&advancedActiveKey=agentPlan
    api_key=os.getenv('AGENT_API_KEY'),
)

imagesResponse = client.images.generate(
    model="doubao-seedream-5.0-lite",
    prompt="充满活力的特写编辑肖像，模特眼神犀利，头戴雕塑感帽子，色彩拼接丰富，眼部焦点锐利，景深较浅，具有Vogue杂志封面的美学风格，采用中画幅拍摄，工作室灯光效果强烈。",
    size="2K",
    output_format="png",
    response_format="url",
    extra_body={
        "watermark": False,
    },
)

print(imagesResponse.data[0].url)
```



</Tab>
</Tabs>


<span id="5c2f8d1a"></span>
# 支持模型及能力

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">注意</div>


<div data-tips="true" data-tips-type="warning">Agent Plan 的套餐支持的模型不同，具体参见<a href="https://docs.volcengine.com/docs/82379/2366394#3d801f5f">支持模型及 Harness</a>。</div>


<span id="7a1c4e9b"></span>
## 生视频模型


<span aceTableMode="list" aceTableWidth="1,1,1,1,1,1"></span>
|模型 | |doubao\-seedance\-2.0 |doubao\-seedance\-2.0\-fast |doubao\-seedance\-2.0\-mini【New】 |doubao\-seedance\-1.5\-pro`即将下线` |
|---|---|---|---|---|---|
|文生视频 | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|图生视频\-首帧 | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|图生视频\-首尾帧 | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|多模态参考 |图片参考 |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |\- |
||视频参考 |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |\- |
||组合参考<br><br><br>* 图片 + 音频<br><br>* 图片 + 视频<br><br>* 视频 + 音频<br><br>* 图片 + 视频 + 音频 |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |*  |
|编辑视频 | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |\- |
|延长视频 | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |\- |
|生成有声视频 | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|联网搜索工具 | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |\- |
|样片模式 | |\- |\- |\- |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|返回视频产物对应的尾帧图 | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|输出视频规格 |输出分辨率 |480p, 720p, 1080p, 4k【New】 |480p, 720p |480p, 720p |480p, 720p, 1080p |
||输出宽高比 |21:9, 16:9, 4:3, 1:1, 3:4, 9:16 |21:9, 16:9, 4:3, 1:1, 3:4, 9:16 |21:9, 16:9, 4:3, 1:1, 3:4, 9:16 |21:9, 16:9, 4:3, 1:1, 3:4, 9:16 |
||输出时长 |4~15 秒 |4~15 秒 |4~15 秒 |4~12 秒 |
||输出视频格式 |mp4 |mp4 |mp4 |mp4 |
|抵扣系数 | |* 输出视频分辨率为 480p，720p<br><br>   * 输入包含视频：140<br><br>   * 输入不含视频：230<br><br>* 输出视频分辨率为 1080p<br><br>   * 输入包含视频：155<br><br>   * 输入不含视频：255<br><br>* 输出视频分辨率为 4k<br><br>   * 输入包含视频：80<br><br>   * 输入不含视频：130 |* 输入包含视频：110<br><br>* 输入不含视频：185 |* 输入包含视频：70<br><br>* 输入不含视频：115 |* 无声视频：36<br><br>* 有声视频：72 |


<span id="0e9a63f4"></span>
## 生图模型


<span aceTableMode="list" aceTableWidth="2,2,2"></span>
|模型 | |doubao\-seedream\-5.0\-lite |
|---|---|---|
|文生图 | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|文生组图 | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|单 / 多图生图 | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|单 / 多图生组图 | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|流式输出 | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|联网搜索 | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|模型参数 |分辨率 |2K, 3K, 4K |
||输出格式 |png, jpeg |
||提示词优化模式 |标准模式 |
||生成数量 |输入的参考图数量 + 最终生成的图片数量 ≤ 15张 |
|抵扣系数 | |1 张成功生成的图片 = 99 AFP |




