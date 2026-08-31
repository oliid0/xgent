import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocale } from "../i18n";
import { writeClipboardText } from "../lib/system/clipboardText";

type FallbackLabels = {
  title: string;
  description: string;
  reload: string;
  copy: string;
};

type ErrorBoundaryInnerProps = {
  children: ReactNode;
  labels: FallbackLabels;
};

type ErrorBoundaryInnerState = {
  error: Error | null;
  componentStack: string;
};

class ErrorBoundaryInner extends Component<ErrorBoundaryInnerProps, ErrorBoundaryInnerState> {
  state: ErrorBoundaryInnerState = { error: null, componentStack: "" };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryInnerState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AppErrorBoundary]", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <Center width="100%" height="100%" padding={8}>
        <VStack gap={4} width="100%" maxWidth="var(--xgent-content-width-md)">
          <Banner
            status="error"
            title={this.props.labels.title}
            description={this.props.labels.description}
            collapsible={{ defaultIsOpen: import.meta.env.DEV }}
            endContent={
              <HStack gap={2}>
                <Button
                  variant="primary"
                  label={this.props.labels.reload}
                  onClick={() => window.location.reload()}
                >
                  {this.props.labels.reload}
                </Button>
                <Button
                  label={this.props.labels.copy}
                  variant="ghost"
                  onClick={() => {
                    void writeClipboardText(
                      `${error.stack ?? error.message}\n${this.state.componentStack}`,
                    );
                  }}
                >
                  {this.props.labels.copy}
                </Button>
              </HStack>
            }
          >
            <Text
              as="div"
              type="supporting"
              color="secondary"
              className="max-h-40 overflow-auto whitespace-pre-wrap font-mono"
            >
              {error.message}
              {import.meta.env.DEV && this.state.componentStack
                ? `\n${this.state.componentStack}`
                : null}
            </Text>
          </Banner>
        </VStack>
      </Center>
    );
  }
}

export function AppErrorBoundary(props: { children: ReactNode }) {
  const { t } = useLocale();
  return (
    <ErrorBoundaryInner
      labels={{
        title: t("app.errorBoundaryTitle"),
        description: t("app.errorBoundaryDesc"),
        reload: t("app.errorBoundaryReload"),
        copy: t("app.errorBoundaryCopy"),
      }}
    >
      {props.children}
    </ErrorBoundaryInner>
  );
}
