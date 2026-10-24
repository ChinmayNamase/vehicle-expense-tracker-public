# Builds and runs the Vehicle Expense Tracker Java server (used by Render).
# Build context = the repository root, so the website files (../*.html, css, js) can be packaged too.

# ---- 1. build the jar with Maven ----
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY . .
RUN mvn -q -B -f backend-api/pom.xml package -DskipTests

# ---- 2. run it on a small Java runtime image ----
FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 appuser
COPY --from=build /src/backend-api/target/vehicle-tracker-api-1.0.0.jar app.jar
USER appuser
ENV SPRING_PROFILES_ACTIVE=prod \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -XX:+UseSerialGC"
EXPOSE 8081
CMD ["java", "-jar", "app.jar"]
